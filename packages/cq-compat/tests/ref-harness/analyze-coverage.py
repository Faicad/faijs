#!/usr/bin/env python3
"""analyze-coverage.py — which CadQuery test cases can cq-compat actually port?

Parity plan §6.4 / §10: before writing any mirror case we need an evidence-based
answer to "移植哪些测试". This script produces that answer by static analysis:

  1. reflect the REAL CadQuery surface via Python introspection
     (Workplane / Assembly / Sketch / Shape public methods) -> the op universe
  2. AST-scan every case body that the ref harness actually exported to STEP
     (`out/ref/manifest.json`) -> the ops each case really touches
  3. subtract what `@faicad/cq-compat` implements -> portable vs blocked, with the
     first missing op per case (`blockedBy`)

Only stdlib is needed. Uses the same CadQuery tag snapshot as `run-ref.py`.

Usage:
    python tests/ref-harness/analyze-coverage.py [--json out.json] [--top 25]
"""

from __future__ import annotations

import ast
import json
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.join(HERE, "..", "..")
CACHE_TESTS = os.path.join(PKG, "out", "cache", "v2.8.0", "tests")
REF_MANIFEST = os.path.join(PKG, "out", "ref", "manifest.json")

# --------------------------------------------------------------------------
# cq-compat surface (source of truth: packages/cq-compat/src/index.ts)
# Workplane: Workplane add box rect circle polygon extrude cutBlind hole
#   cboreHole cskHole threadedHole faces edges vertices workplane center
#   pushPoints translate rotate mirror union cut intersect fillet shell
#   val vals transformed setColor
# Assembly: faceRef constraint buildAssembly Color
# --------------------------------------------------------------------------
CQ_COMPAT_OPS = {
    "Workplane", "add", "box", "rect", "circle", "polygon", "extrude", "cutBlind",
    "cutThruAll", "hole", "cboreHole", "cskHole", "threadedHole", "faces", "edges",
    "vertices", "workplane", "center", "pushPoints", "rarray", "translate", "rotate",
    "mirror", "union", "cut", "intersect", "combine", "fillet", "chamfer", "shell",
    "sphere", "cylinder", "val", "vals", "transformed", "setColor",
    "faceRef", "constraint", "buildAssembly", "Color",
}

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


# --------------------------------------------------------------------------
# 1. CadQuery op universe (reflected from the real package)
# --------------------------------------------------------------------------
def cadquery_op_universe() -> set[str]:
    """Public modelling methods of the installed CadQuery.

    Requires the venv from tests/baseline.json. Falls back to an empty set so the
    analysis still runs (it then treats every attr call as an op).
    """
    try:
        import cadquery as cq  # noqa: PLC0415
    except Exception:  # noqa: BLE001
        return set()
    universe: set[str] = set()
    for cls in (cq.Workplane, cq.Assembly, cq.Sketch):
        universe |= {n for n in dir(cls) if not n.startswith("_")}
    for cls in (cq.Shape, cq.Workplane):
        universe |= {n for n in dir(cls) if not n.startswith("_")}
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
    """Attribute-call names reachable from an expression node."""
    names: list[str] = []
    for sub in ast.walk(node):
        if isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute):
            n = sub.func.attr
            if n in ignored or n in names:
                continue
            if universe and n not in universe:
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
    if matched:
        return ops, False
    # fallback: whole body (e.g. var built in a for-loop or returned expression)
    return calls_in(fn, universe, ignored), True


# --------------------------------------------------------------------------
# 3. main
# --------------------------------------------------------------------------
def main() -> int:
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

    report = {
        "totalCasesInRefManifest": len(results),
        "casesWithStep": len(exported_cases),
        "casesWithoutStep": len([r for r in results if r.get("status") != "exported"]),
        "portableNow": len(portable),
        "portableWithStub": len(stubbed),
        "blocked": len(blocked),
        "blockedByTop": block_counter.most_common(top_n),
        "missingOpTop": op_counter.most_common(top_n),
        # flat per-case map consumed by tests/gen-manifest.ts
        "cases": {
            r["case"]: {
                "status": r.get("status"),
                "category": r.get("category"),
                "blockedBy": r.get("blockedBy"),
                "ops": r.get("ops", []),
                "vars": r.get("vars", []),
            }
            for r in results
        },
        "portableCases": [
            {"case": r["case"], "ops": r["ops"], "vars": r["vars"],
             "fellBack": r.get("fellBack", False)}
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

    text = json.dumps(report, indent=2, ensure_ascii=False)
    if "--json" in sys.argv:
        with open(sys.argv[sys.argv.index("--json") + 1], "w", encoding="utf-8") as fh:
            fh.write(text)
        print(f"wrote {sys.argv[sys.argv.index('--json') + 1]}", file=sys.stderr)
    print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
