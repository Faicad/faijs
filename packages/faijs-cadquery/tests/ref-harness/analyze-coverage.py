#!/usr/bin/env python3
"""analyze-coverage.py — which CadQuery test cases can cq-compat actually port?

Parity plan §6.4 / §10: before writing any mirror case we need an evidence-based
answer to "移植哪些测试". This script produces that answer by static analysis:

  1. reflect the REAL CadQuery surface via Python introspection
     (Workplane / Assembly / Sketch / Shape public methods) -> the op universe
  2. AST-scan every case body that the ref harness actually exported to STEP
     (`out/ref/manifest.json`) -> the ops each case really touches
  3. subtract what `@faicad/faijs-cadquery` implements -> portable vs blocked, with the
     first missing op per case (`blockedBy`)
  4. label every op by its OUTPUT DIMENSION (`geometry-producing` /
     `value-producing` / `plumbing` — audit §5.4) so the report can tell
     "geometry aligned" apart from "semantics aligned". Value ops with no §5.1
     truth assertion are reported as blind spots instead of silently counting
     as covered.

Only the api layer is needed. Uses the same CadQuery tag snapshot as `run-ref.py`.

Usage:
    python tests/ref-harness/analyze-coverage.py [--json out.json] [--top 25]
"""

from __future__ import annotations

import ast
import json
import os
import re
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.join(HERE, "..", "..")
CACHE_TESTS = os.path.join(PKG, "out", "cache", "v2.8.0", "tests")
REF_MANIFEST = os.path.join(PKG, "out", "ref", "manifest.json")

# --------------------------------------------------------------------------
# cq-compat surface
#
# The AUTHORITATIVE source is the published export surface of the CadQuery
# compatibility layer — today a single package, @faicad/faijs-cadquery, which
# carries the Workplane grammar, the 2D Sketch grammar and (upstream) the
# assembly helpers. The file is parsed at run time below, so exporting a new op
# is enough to make it count.
#
# WHY (2026-09-30): this used to be a hand-copied literal. It silently drifted
# from the code — `close`/`lineTo`/`spline`/`polyline`/`wire`/`face`/`loft`/
# `twistExtrude`/`workplaneFromTagged`/`clean`… were all implemented but still
# counted as missing, so ~130 cases were reported BLOCKED that were not. The
# committed coverage.json was likewise one script-revision behind itself.
#
# WHY this list was rewritten (2026-10-03): it used to name three packages
# (`cq-compat`, `cq-compat-assembly`, `cq-compat-sketch`). The rename commit
# folded them all into @faicad/faijs-cadquery — the assembly surface became the
# `./assembly` subpath and the 2D Sketch grammar the `./sketch` subpath — so
# every path here 404'd. Because the surface is read at import time the script
# died before doing anything, and it stayed dead from that rename onwards:
# exactly the drift this section exists to prevent. Fail loudly, but point at
# paths that still resolve.
#
# CQ_COMPAT_EXTRA below is a *supplement* for upstream names that are genuinely
# implemented but not exported under that exact name. Keep it small and
# justified; the moment a name becomes a real export it is redundant here.
# --------------------------------------------------------------------------
# All three public subpath entries of @faicad/faijs-cadquery's CadQuery surface
# (`package.json` `exports`): the root grammar, the assembly solver subpath
# (merged 2026-10-02 from the ex standalone cq-compat-assembly package) and the
# unprefixed 2D Sketch grammar.
CQ_COMPAT_PACKAGES = (
    os.path.join("faijs-cadquery", "src", "index.ts"),
    os.path.join("faijs-cadquery", "src", "assembly", "index.ts"),
    os.path.join("faijs-cadquery", "src", "sketch-pkg.ts"),
)

# Upstream names that ARE implemented, just under a different spelling.
CQ_COMPAT_EXTRA: set[str] = {
    # `cadquery.func.fuse(a, b, …)` is cq-compat's `union` (its mirrors call the
    # latter — see tests/test_free_functions/test_fuse_multi__*.fai.js).
    "fuse",
}


def cq_compat_export_surface() -> set[str]:
    """Every public export name of the cq-compat packages (re-export aliases use
    the alias, not the local symbol: `sketchRect as rect` contributes `rect`)."""
    names: set[str] = set()
    for rel in CQ_COMPAT_PACKAGES:
        path = os.path.normpath(os.path.join(PKG, "..", rel))
        try:
            src = open(path, encoding="utf-8").read()
        except OSError as exc:
            # Fail loud: a silently-empty surface would report everything BLOCKED.
            raise SystemExit(f"analyze-coverage: cannot read export surface {path}: {exc}")
        for block in re.finditer(r"export\s*\{([^}]*)\}", src, re.S):
            for raw in block.group(1).split(","):
                item = re.sub(r"^\s*type\s+", "", raw.strip())
                if not item:
                    continue
                alias = re.split(r"\s+as\s+", item)
                names.add((alias[1] if len(alias) > 1 else alias[0]).strip())
        for decl in re.finditer(
            r"export\s+(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_$]+)", src
        ):
            names.add(decl.group(1))
    if not names:
        raise SystemExit("analyze-coverage: cq-compat export surface is empty — refusing to guess")
    return names


CQ_COMPAT_OPS = CQ_COMPAT_EXTRA | cq_compat_export_surface()

# Cases whose calls fall in a deliberately unsupported parameter corner of an
# otherwise-implemented op (P4 batch 1). Explicit exceptions keep them honest
# instead of silently "portable then failing at mirror runtime".
CASE_NARROW_EXCEPTIONS = {
    # sphere(angle1=0, ...) — partial spheres unsupported (full spheres only)
    "tests.test_cadquery::TestCadQuery::testSphereCustom": "narrow:sphere-angles",
    # chamfer(0.1, 0.2) — occt-wasm kernel chamfer is uniform-distance only
    "tests.test_cadquery::TestCadQuery::testChamferAsymmetrical": "narrow:chamfer-asym",
}

# Ops that are implemented but with a NARROWER selector grammar than upstream.
NARROW_SELECTORS = {"faces", "edges", "vertices"}

# `cadquery.func` names that are geometry *type constructors* / data holders,
# not modelling ops: the tests use them as values (`segment(Vector(0,0,0), …)`)
# and in assertions, so counting them as ops would flag nearly every case. They
# are excluded from the op universe on purpose (everything else in `cadquery.func`
# IS modelling surface).
CQ_FUNC_DATA_TYPES = {
    "CompSolid", "Compound", "Edge", "Face", "History", "Location", "Plane",
    "Shape", "Shell", "Solid", "Vector", "Vertex", "Wire",
}

# Non-modelling calls that must never count as blocking: pure queries, result
# inspection, assertion helpers. Anything here is part of the test's *verification*,
# not of the geometry being built.
IGNORED = {
    # selectors that only filter/narrow (we care about building ops)
    "all", "first", "last", "item", "get", "sortBy", "filterBy", "toArray",
    "val", "vals", "valWrapped", "valWrapper", "shape", "shapes", "findSolid",
    "solids", "faces", "edges", "vertices", "wires", "compounds",
    # Shape-level inspection used by asserts
    "Volume", "Area", "Length", "Distance", "isValid", "Center", "CenterOfBoundBox",
    "exportStep", "toCompound", "addShape", "copy", "deepcopy", "newObject",
    "BoundingBox", "Faces", "Edges", "Vertices", "Solids", "Wires", " ShapeType",
    "Type", "hashCode", "IsEqual", "Tolerance", "Locations", "CenterOfMass",
}

# Every operator that would make a case un-portable for structural reasons.
CQ_MODULE_DEPS = {"cq_warehouse", "cq_server", "numpy", "scipy", "vtk", "IPython"}

# Hard portability barriers that are NOT part of the CadQuery modelling surface,
# so `cadquery_op_universe()` reflection cannot see them and they would otherwise
# be dropped as "not an op". Plan §3 layer C (permanently blocked candidates).
STRUCTURAL_BLOCKERS = {
    # pytest machinery — a mirror script has no fixture injection
    "getfixturevalue", "parametrize", "fixture",
    # exporters cq-compat does not provide (assembly → vtkjs / vrml / glTF / JSON)
    "exportGLTF", "exportVrml", "exportVTKJS", "toJSON",
    # python object protocol — nothing to mirror
    "__dir__",
}


# --------------------------------------------------------------------------
# 1b. Output-dimension labels (audit §5.4)
#
# "Is op X implemented?" is the wrong question. An op's *output dimension*
# decides whether the STEP-geometry comparator can ever see it:
#
#   geometry-producing  → the result lands in the exported STEP, so
#                         `compare.ts` validates it. Coverage here means
#                         "geometry aligned".
#   value-producing     → returns a sub-shape reference, a scalar, or metadata
#                         (selectors, object-stack destructuring, Shape
#                         introspection, coordinate transforms). None of it
#                         reaches the STEP file, so `compare.ts` is BLIND to it.
#                         Coverage here means nothing unless a §5.1 one-shot
#                         truth assertion exists for that op.
#   plumbing            → test scaffolding, exporters, python object protocol.
#                         Neither channel applies.
#
# WHY this exists (2026-10-03): every "silent gap" the audit found (§3.2–§3.5)
# was an op that was counted as ported because it was exported, while the thing
# it actually returns was never compared. Labelling makes that visible: the
# report can now separate "geometry aligned" from "semantics aligned".
# --------------------------------------------------------------------------
GEOMETRY_PRODUCING = "geometry-producing"
VALUE_PRODUCING = "value-producing"
PLUMBING = "plumbing"

# Upstream ops whose output is a sub-shape reference, a value, or metadata —
# i.e. invisible to STEP comparison. Selectors come first (they hand back
# references into an existing shape), then the Shape/Workplane query surface.
VALUE_OPS: set[str] = {
    # selectors / object-stack destructuring
    "faces", "edges", "vertices", "wires", "shells", "solids", "compounds",
    "all", "first", "last", "item", "get", "sortBy", "filterBy", "toArray",
    "val", "vals", "valWrapped", "valWrapper", "shape", "shapes", "findSolid",
    "select", "tag", "end", "nth",
    # Shape introspection queries (values, not geometry)
    "Volume", "Area", "Length", "Distance", "isValid", "Center",
    "CenterOfBoundBox", "CenterOfMass", "BoundingBox", "ShapeType", "geomType",
    "Faces", "Edges", "Vertices", "Solids", "Wires", "Shells", "Compounds",
    "Locations",
    # coordinate transforms (return a transformed point/shape, compared by value)
    "toLocalCoords", "toWorldCoords", "mirrorInPlane",
}

# Plumbing: never a portability signal, never a parity signal either.
PLUMBING_OPS: set[str] = {
    "exportStep", "toCompound", "addShape", "copy", "deepcopy", "newObject",
    "Type", "hashCode", "IsEqual", "Tolerance", " ShapeType",
} | STRUCTURAL_BLOCKERS

# Upstream value ops whose semantics are ALREADY pinned by a §5.1 one-shot
# CadQuery 2.8.0 capture frozen into a TS assertion. Keeping this list honest is
# the point of the whole section: an op here has a real truth anchor, an op
# outside it is a blind spot no matter what the export surface says.
VERIFIED_VALUE_OPS: set[str] = {
    # selectors — src/selectors.test.ts, src/selectors-narrowing.test.ts,
    #             src/object-selectors.test.ts (43 cases)
    "faces", "edges", "vertices",
    # kind selectors — src/kind-selectors.test.ts (12 cases)
    "wires", "shells", "solids", "compounds",
    # 2D sketch selectors — src/sketch-selectors.test.ts (18 cases)
    "select",
    # Shape introspection — src/shape-class.test.ts
    "Volume", "Area", "Length", "Center", "BoundingBox", "isValid", "geomType",
    # plane transforms — src/plane.test.ts (16 cases)
    "toLocalCoords", "toWorldCoords", "mirrorInPlane",
}


def dimension_of(op: str) -> str:
    """Output dimension of an upstream op (see the block above)."""
    if op in VALUE_OPS:
        return VALUE_PRODUCING
    if op in PLUMBING_OPS:
        return PLUMBING
    return GEOMETRY_PRODUCING


def split_dimensions(ops: list[str]) -> dict[str, list[str]]:
    """Bucket a case's ops by output dimension, order preserved."""
    out: dict[str, list[str]] = {GEOMETRY_PRODUCING: [], VALUE_PRODUCING: [], PLUMBING: []}
    for op in ops:
        out[dimension_of(op)].append(op)
    return out


# --------------------------------------------------------------------------
# 1. CadQuery op universe (reflected from the real package)
# --------------------------------------------------------------------------
def cadquery_op_universe() -> set[str]:
    """Public modelling surface of the installed CadQuery.

    Covers BOTH grammars: the Workplane/Shape/Sketch/Assembly *methods* and the
    `cadquery.func` *free functions* (`from cadquery.func import *`). The latter
    is a separate namespace — `faceOn` / `wireOn` / `edgeOn` / `imprint` /
    `project` / `fill` exist ONLY as free functions, never as methods.

    WHY the func module matters (2026-09-30): `calls_in` uses this set to tell a
    real CadQuery call apart from a module-local helper. With only the class
    methods, a func-only call was dropped, so `test_faceOn` (`faceOn(f, text(…))`)
    traced to just `{text}` — both implemented — and was reported PORTABLE while
    the case is genuinely blocked on `faceOn`. Reflecting the free-function
    grammar closes that blind spot. Requires the venv from tests/baseline.json;
    falls back to an empty set so the analysis still runs.
    """
    try:
        import cadquery as cq  # noqa: PLC0415
        import cadquery.func as cqfunc  # noqa: PLC0415
    except Exception:  # noqa: BLE001
        return set()
    universe: set[str] = set()
    for cls in (cq.Workplane, cq.Assembly, cq.Sketch):
        universe |= {n for n in dir(cls) if not n.startswith("_")}
    for cls in (cq.Shape, cq.Workplane):
        universe |= {n for n in dir(cls) if not n.startswith("_")}
    universe |= {
        n for n in dir(cqfunc) if not n.startswith("_")
    } - CQ_FUNC_DATA_TYPES
    return universe


# --------------------------------------------------------------------------
# 2. AST index of every test case in a module
# --------------------------------------------------------------------------
def index_functions(tree: ast.AST) -> dict[str, ast.FunctionDef]:
    """Map 'Class::test' and 'test' (module-level) to their FunctionDef node."""
    out: dict[str, ast.FunctionDef] = {}

    def walk(node: ast.AST, prefix: str) -> None:
        for child in ast.iter_child_nodes(node):
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)):
                name = f"{prefix}::{child.name}" if prefix else child.name
                out[name] = child  # type: ignore[assignment]
                walk(child, prefix)  # nested defs: keep flat, same prefix
            elif isinstance(child, ast.ClassDef):
                walk(child, f"{prefix}::{child.name}" if prefix else child.name)

    walk(tree, "")
    return out


def collect_calls(fn: ast.FunctionDef) -> list[str]:
    """Every attribute-call name inside a function body (dedup, order kept)."""
    names: list[str] = []
    for node in ast.walk(fn):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
            n = node.func.attr
            if n not in names:
                names.append(n)
    return names


def collect_free_calls(fn: ast.FunctionDef) -> set[str]:
    """Module-level / free function calls, used to spot heavy helpers."""
    out: set[str] = set()
    for node in ast.walk(fn):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            out.add(node.func.id)
    return out


def calls_in(node: ast.AST, universe: set[str], ignored: set[str]) -> list[str]:
    """Op-call names reachable from an expression node.

    Counts BOTH `x.op(...)` (Workplane/Shape/Sketch methods) and bare `op(...)`
    (the `cadquery.func` free-function grammar: `box(...)`, `text(...)`,
    `cylinder(...)`). Bare calls are filtered by the same op universe, which is
    what keeps module-local helpers (`makeUnitCube()`) out: they are not
    CadQuery attributes, so they never match.

    WHY (2026-09-30): bare calls used to be ignored entirely, so a case whose
    geometry is *entirely* free-function calls traced to zero ops and was then
    reported PORTABLE with no evidence at all (54 of 297 cases).
    """
    names: list[str] = []
    for sub in ast.walk(node):
        if not isinstance(sub, ast.Call):
            continue
        fn = sub.func
        if isinstance(fn, ast.Attribute):
            n = fn.attr
        elif isinstance(fn, ast.Name):
            n = fn.id
        else:
            continue
        if n in ignored or n in names:
            continue
        if universe and n not in universe and n not in STRUCTURAL_BLOCKERS:
            continue
        names.append(n)
    return names


def assignments(fn: ast.FunctionDef) -> dict[str, list[ast.AST]]:
    """target name -> every RHS node assigned to it (empty slots count once)."""
    out: dict[str, list[ast.AST]] = {}
    for node in ast.walk(fn):
        targets: list[ast.expr] = []
        value: ast.AST | None = None
        if isinstance(node, ast.Assign):
            targets, value = list(node.targets), node.value
        elif isinstance(node, (ast.AnnAssign, ast.AugAssign)):
            targets, value = [node.target], node.value
        if value is None:
            continue
        for t in targets:
            if isinstance(t, ast.Name):
                out.setdefault(t.id, []).append(value)
            elif isinstance(t, (ast.Tuple, ast.List)):
                for elt in t.elts:
                    if isinstance(elt, ast.Name):
                        out.setdefault(elt.id, []).append(value)
    return out


def expand_helpers(free_calls: set[str], index: dict[str, ast.FunctionDef],
                   universe: set[str], ignored: set[str],
                   depth: int = 2) -> tuple[list[str], list[str]]:
    """Inline module-local helper functions to see what ops they really use.

    A surprising number of upstream cases build their geometry in a helper
    (`c = CQ(makeUnitCube())`), so body-only tracing reports zero ops and would
    wrongly look portable. Returns (helper names used, ops found inside them).
    """
    ops: list[str] = []
    used: list[str] = []
    seen: set[str] = set()

    def rec(names: set[str], d: int) -> None:
        if d <= 0:
            return
        for name in sorted(names):
            if name in seen:
                continue
            fn = index.get(name)
            if fn is None or name.startswith("test"):
                continue
            seen.add(name)
            used.append(name)
            for n in calls_in(fn, universe, ignored):
                if n not in ops:
                    ops.append(n)
            rec({c.func.id for c in ast.walk(fn)
                 if isinstance(c, ast.Call) and isinstance(c.func, ast.Name)}, d - 1)

    rec(free_calls, depth)
    return used, ops


def trace_calls(fn: ast.FunctionDef, vars_: list[str], universe: set[str],
                ignored: set[str]) -> tuple[list[str], bool]:
    """Calls belonging to the *definition chain* of the exported variables.

    Tracing only the exported variables keeps the assertion/`solids()` scaffolding
    out of the op list — assertions must never decide whether a case is portable.

    Returns (ops, fell_back). `fell_back` is True when no assignment matched (e.g.
    the variable is built inside a for-loop), so we scan the whole body instead —
    weaker evidence, flagged in the report.
    """
    assign = assignments(fn)
    ops: list[str] = []
    matched = False
    for v in vars_:
        for rhs in assign.get(v, []):
            matched = True
            for n in calls_in(rhs, universe, ignored):
                if n not in ops:
                    ops.append(n)
    if matched and ops:
        return ops, False
    # No evidence from the definition chain — either nothing matched the exported
    # variable, or its RHS named no CadQuery op at all. The second case is not
    # hypothetical: `assy = Assembly("name")` names only the (non-op) constructor,
    # while the geometry appears later as `assy.add(...)` / `constraint(...)`
    # mutations. Falling back to the whole body is weaker evidence (it can see
    # assertion scaffolding), so it is flagged via `fellBack` in the report.
    return calls_in(fn, universe, ignored), True


# --------------------------------------------------------------------------
# 3. main
# --------------------------------------------------------------------------
def self_test() -> int:
    """Invariants of the dimension labelling (audit §5.4).

    `--self-test` runs without the ref manifest or a CadQuery install, so it can
    be re-run after any edit to the op sets. It guards the two ways the labels
    go wrong: an op in two dimensions at once, and a "verified" op that is not a
    value op at all (which would quietly zero out a blind spot).
    """
    checks: list[tuple[str, bool]] = []

    checks.append(("dimensions are disjoint",
                   not (VALUE_OPS & PLUMBING_OPS)))
    checks.append(("verified subset of value ops",
                   VERIFIED_VALUE_OPS <= VALUE_OPS))
    checks.append(("no selector counted as geometry",
                   all(dimension_of(n) == VALUE_PRODUCING
                       for n in ("faces", "edges", "vertices", "wires",
                                 "solids", "shells", "compounds"))))
    checks.append(("no query counted as geometry",
                   all(dimension_of(n) == VALUE_PRODUCING
                       for n in ("Volume", "Area", "Length", "Center",
                                 "BoundingBox", "isValid", "CenterOfMass"))))
    checks.append(("modelling ops stay geometry",
                   all(dimension_of(n) == GEOMETRY_PRODUCING
                       for n in ("box", "cylinder", "extrude", "cut", "union",
                                 "fillet", "chamfer", "hole", "workplane"))))
    checks.append(("structural blockers are plumbing",
                   all(dimension_of(n) == PLUMBING for n in STRUCTURAL_BLOCKERS)))
    buckets = split_dimensions(["box", "faces", "exportStep"])
    checks.append(("split_dimensions buckets by dimension",
                   buckets[GEOMETRY_PRODUCING] == ["box"]
                   and buckets[VALUE_PRODUCING] == ["faces"]
                   and buckets[PLUMBING] == ["exportStep"]))
    checks.append(("export surface non-empty", len(CQ_COMPAT_OPS) > 0))

    failed = [name for name, ok in checks if not ok]
    for name, ok in checks:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
    if failed:
        print(f"self-test FAILED: {len(failed)} invariant(s)", file=sys.stderr)
        return 1
    print(f"self-test ok ({len(checks)} invariants, "
          f"{len(CQ_COMPAT_OPS)} ops in the cq surface)")
    return 0


def main() -> int:
    if "--self-test" in sys.argv:
        return self_test()

    top_n = 25
    if "--top" in sys.argv:
        top_n = int(sys.argv[sys.argv.index("--top") + 1])

    if not os.path.exists(REF_MANIFEST):
        print(f"missing {REF_MANIFEST} — run tests/ref-harness/run-ref.py first", file=sys.stderr)
        return 2

    ref = json.load(open(REF_MANIFEST, encoding="utf-8"))
    universe = cadquery_op_universe()

    # case id -> (module, qualname)
    # harness ids: "tests.mod::Class::test" for methods and
    # "tests.mod:::test" (extra colon) for module-level functions — lstrip it.
    cases: list[tuple[str, str, str]] = []
    for case_id in ref:
        body = case_id.split("::", 1)
        module = body[0][len("tests."):] if body[0].startswith("tests.") else body[0]
        cases.append((case_id, module, body[1].lstrip(":")))

    trees: dict[str, tuple[ast.AST, dict[str, ast.FunctionDef]]] = {}
    for module in {c[1] for c in cases}:
        path = os.path.join(CACHE_TESTS, f"{module}.py")
        if not os.path.exists(path):
            continue
        tree = ast.parse(open(path, encoding="utf-8").read(), filename=path)
        trees[module] = (tree, index_functions(tree))

    # tests/__init__.py hosts shared helpers (makeUnitCube, BaseTest…); merge it
    # so expand_helpers can inline geometry that lives outside the test module.
    init_path = os.path.join(CACHE_TESTS, "__init__.py")
    if os.path.exists(init_path):
        init_tree = ast.parse(open(init_path, encoding="utf-8").read(), filename=init_path)
        init_index = index_functions(init_tree)

    results = []
    for case_id, module, qual in cases:
        if module not in trees:
            results.append({
                "case": case_id, "module": module, "status": "no-source",
                "ops": [], "missing": [], "blockedBy": None,
            })
            continue
        _, index = trees[module]
        helper_index = {**init_index, **index}
        fn = index.get(qual)
        if fn is None:
            results.append({
                "case": case_id, "module": module, "status": "unresolved",
                "ops": [], "missing": [], "blockedBy": None,
            })
            continue
        free = collect_free_calls(fn)
        # whether this case actually produced a STEP we can compare against
        exported = [v for v in ref[case_id] if isinstance(v, dict) and "file" in v]
        exported_vars = [v["var"] for v in exported]
        status = "exported" if exported else "no-step"
        # keep only real CadQuery surface calls, traced from the exported variables
        ops, fell_back = trace_calls(fn, exported_vars, universe, IGNORED)
        helpers, helper_ops = expand_helpers(free, helper_index, universe, IGNORED)
        missing = [n for n in ops if n not in CQ_COMPAT_OPS]
        helper_missing = [n for n in helper_ops if n not in CQ_COMPAT_OPS]
        # Second pass with the value ops UN-ignored: `ops` deliberately drops
        # selectors/queries so they cannot block a case, but the dimension
        # labels need to see them — that is the whole point of §5.4.
        touched, _ = trace_calls(fn, exported_vars, universe, IGNORED - VALUE_OPS)
        dims = split_dimensions(touched)
        unverified_value_ops = [n for n in dims[VALUE_PRODUCING]
                                if n not in VERIFIED_VALUE_OPS]
        deps = sorted(free & CQ_MODULE_DEPS)
        if missing:
            category = "BLOCKED"
        elif helpers:
            # geometry lives in a helper — portable only if the mirror re-creates
            # that primitive with ops we already have (e.g. makeUnitCube -> box)
            category = "PORTABLE-WITH-STUB"
        else:
            category = "PORTABLE"
        blocked_by = missing[0] if missing else (f"deps:{deps[0]}" if deps else None)
        if category == "PORTABLE-WITH-STUB" and helper_missing:
            blocked_by = f"stub:{helper_missing[0]}"
        # Explicit parameter-corner exceptions (see CASE_NARROW_EXCEPTIONS):
        # the op exists but the case's parameter combination is deliberately
        # unsupported, so the case must stay blocked with a truthful reason.
        if case_id in CASE_NARROW_EXCEPTIONS and category != "BLOCKED":
            category = "BLOCKED"
            blocked_by = CASE_NARROW_EXCEPTIONS[case_id]
        results.append({
            "case": case_id, "module": module, "qual": qual, "status": status,
            "ops": ops, "missing": missing, "deps": deps, "blockedBy": blocked_by,
            "category": category, "helpers": helpers, "helperOps": helper_ops,
            "helperMissing": helper_missing,
            "steps": len(exported), "fellBack": fell_back,
            "vars": exported_vars,
            "dims": {k: v for k, v in dims.items() if v},
            "unverifiedValueOps": unverified_value_ops,
        })

    exported_cases = [r for r in results if r.get("status") == "exported"]
    portable = [r for r in exported_cases if r.get("category") == "PORTABLE"]
    stubbed = [r for r in exported_cases if r.get("category") == "PORTABLE-WITH-STUB"]
    blocked = [r for r in exported_cases if r.get("category") == "BLOCKED"]

    block_counter: Counter[str] = Counter()
    for r in blocked:
        if r["blockedBy"]:
            block_counter[r["blockedBy"]] += 1

    op_counter: Counter[str] = Counter()
    for r in exported_cases:
        op_counter.update(set(r["missing"]))

    # --- §5.4 output dimensions -------------------------------------------
    dim_counter: Counter[str] = Counter()
    for r in exported_cases:
        dim_counter.update(set(r.get("dims", {})))
    # A case whose geometry is portable but which touches value ops we have no
    # truth assertion for is the audit's blind spot: STEP parity says PASS while
    # the returned sub-shape / value is unchecked.
    blind = [r for r in exported_cases
             if r.get("category") != "BLOCKED" and r.get("unverifiedValueOps")]
    blind_counter: Counter[str] = Counter()
    for r in blind:
        blind_counter.update(set(r["unverifiedValueOps"]))

    report = {
        "totalCasesInRefManifest": len(results),
        "casesWithStep": len(exported_cases),
        "casesWithoutStep": len([r for r in results if r.get("status") != "exported"]),
        "portableNow": len(portable),
        "portableWithStub": len(stubbed),
        "blocked": len(blocked),
        "blockedByTop": block_counter.most_common(top_n),
        "missingOpTop": op_counter.most_common(top_n),
        # --- §5.4 output dimensions ---------------------------------------
        # `casesTouching` counts exported cases that touch at least one op of a
        # given dimension; `valueBlindSpotCases` counts the non-blocked ones
        # whose value ops have NO §5.1 truth assertion. That number is the
        # honest ceiling on "semantics aligned" — everything above it is
        # geometry-only coverage.
        "dimensionCases": dict(dim_counter),
        "valueBlindSpotCases": len(blind),
        "valueBlindSpotOpTop": blind_counter.most_common(top_n),
        "verifiedValueOps": sorted(VERIFIED_VALUE_OPS),
        # flat per-case map consumed by tests/gen-manifest.ts
        "cases": {
            r["case"]: {
                "status": r.get("status"),
                "category": r.get("category"),
                "blockedBy": r.get("blockedBy"),
                "ops": r.get("ops", []),
                "vars": r.get("vars", []),
                "valueRisk": bool(r.get("unverifiedValueOps")),
                "unverifiedValueOps": r.get("unverifiedValueOps", []),
            }
            for r in results
        },
        "portableCases": [
            {"case": r["case"], "ops": r["ops"], "vars": r["vars"],
             "fellBack": r.get("fellBack", False),
             "unverifiedValueOps": r.get("unverifiedValueOps", [])}
            for r in portable
        ],
        "stubCases": [
            {"case": r["case"], "ops": r["ops"], "vars": r["vars"],
             "helpers": r["helpers"], "helperOps": r["helperOps"],
             "helperMissing": r["helperMissing"]}
            for r in stubbed
        ],
        "blockedCases": [
            {"case": r["case"], "blockedBy": r["blockedBy"], "missing": r["missing"],
             "deps": r["deps"]}
            for r in blocked
        ],
    }

    print(
        f"output dimensions (exported cases): "
        + ", ".join(f"{k}={dim_counter.get(k, 0)}" for k in
                    (GEOMETRY_PRODUCING, VALUE_PRODUCING, PLUMBING)),
        file=sys.stderr,
    )
    print(
        f"value blind spots: {len(blind)} of {len(exported_cases)} exported cases "
        f"touch a value-producing op with NO §5.1 truth assertion",
        file=sys.stderr,
    )
    for op, n in blind_counter.most_common(10):
        print(f"  unverified: {op} ({n} cases)", file=sys.stderr)

    text = json.dumps(report, indent=2, ensure_ascii=False)
    if "--json" in sys.argv:
        with open(sys.argv[sys.argv.index("--json") + 1], "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"wrote {sys.argv[sys.argv.index('--json') + 1]}", file=sys.stderr)
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
