"""cq_step_plugin — pytest plugin that exports every named geometry from every
modeling test case to STEP, without modifying CadQuery source files.

Loaded with:  pytest -p cq_step_plugin

Mechanism: a MetaPathFinder intercepts the target test modules at import time
and rewrites each ``test_*`` function in memory via AST transform:

    def test_x(self):
        <body>
    =>
    def test_x(self):
        try:
            <body>
        finally:
            __CQ_EXPORT__(locals(), "tests.test_x::Class::test_x")

``try/finally`` (not a trailing call) guarantees export on ``return``,
assertion failure and exception paths alike. ``locals()`` covers every *named*
intermediate variable; chained anonymous Workplanes are not captured, which
keeps the exported set small and the variable names mirrorable on the faijs
side.

Environment variables
---------------------
CQ_STEP_OUT        output directory for STEP files + manifest.json
                   (created if missing; a missing directory makes
                   ``Shape.exportStep`` silently return False and drop ALL
                   files — this plugin creates it defensively).
CQ_TARGET_MODULES  JSON array of dotted module names to intercept,
                   e.g. '["tests.test_cadquery", "tests.test_shapes"]'.
CQ_SOURCE_DIRS     JSON array of directories to resolve ``<mod>.py`` from.

Known traps (all encountered in the 2026-09-08 POC, see
docs/plans/2026-09-08-cq-compat-cadquery-parity.md §5.6):
- ``Shape.exportStep()`` returns ``False`` on failure instead of raising;
  every call must be checked.
- Importing cadquery from a source checkout root shadows the installed
  release (dev checkout needs a different OCP); this plugin imports the
  INSTALLED cadquery at module load, before pytest can prepend a checkout
  root to sys.path.
- A hand-written loader must set ``__file__``/``__package__`` or test modules
  using ``Path(__file__).parent`` crash with NameError.
"""

import ast
import importlib.abc
import importlib.util
import json
import os
import sys

# Bind the INSTALLED cadquery before pytest prepends any source checkout root
# to sys.path. See module docstring, trap #2.
import cadquery  # noqa: F401  pylint: disable=wrong-import-position

OUT = os.environ.get("CQ_STEP_OUT", "out/ref")
TARGETS = set(json.loads(os.environ.get("CQ_TARGET_MODULES", "[]")))
SYSDIRS = json.loads(os.environ.get("CQ_SOURCE_DIRS", "[]"))

os.makedirs(OUT, exist_ok=True)
_manifest = {}


def _export(mapping, case_id):
    """Snapshot local variables and export solid geometry to STEP."""
    from cadquery import Shape, Workplane, Assembly

    out = []
    for name, val in list(mapping.items()):
        if name.startswith("__"):
            continue
        try:
            if isinstance(val, Workplane):
                cand = val.val()
            elif isinstance(val, Assembly):
                cand = val.toCompound()
            elif isinstance(val, Shape):
                cand = val
            else:
                continue
            st = cand.ShapeType()
            if st not in ("Solid", "Compound", "CompSolid"):
                continue
            vol = cand.Volume()
            if vol <= 1e-6:
                continue  # Wire/Face/Sketch results carry no solid geometry
            fn = os.path.join(OUT, (case_id + "__" + name).replace(":", "_") + ".step")
            if not cand.exportStep(fn):
                out.append({"var": name, "error": "exportStep returned False"})
                continue
            out.append({"var": name, "type": st, "volume": vol, "file": fn})
        except Exception as e:  # noqa: BLE001 — record and keep the suite running
            out.append({"var": name, "error": f"{type(e).__name__}: {e}"})
    if out:
        _manifest[case_id] = out


class _Transformer(ast.NodeTransformer):
    def __init__(self, module):
        self.module = module
        self.cls = None

    def visit_ClassDef(self, node):
        prev = self.cls
        self.cls = node.name
        self.generic_visit(node)
        self.cls = prev
        return node

    def visit_FunctionDef(self, node):
        self.generic_visit(node)
        if not node.name.startswith("test"):
            return node
        case_id = f"{self.module}::{self.cls or ''}::{node.name}".replace(":::", "::")
        export = ast.parse(f"__CQ_EXPORT__(locals(), {case_id!r})").body[0]
        trynode = ast.Try(body=node.body, handlers=[], orelse=[], finalbody=[export])
        node.body = [trynode]
        ast.fix_missing_locations(node)
        return node


class _Loader(importlib.abc.Loader):
    def __init__(self, fullname, path):
        self.fullname = fullname
        self.path = path

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        with open(self.path, "r", encoding="utf-8") as f:
            src = f.read()
        tree = ast.parse(src, filename=self.path)
        tree = _Transformer(self.fullname).visit(tree)
        d = module.__dict__
        # Hand-written loaders do not set these; test modules using
        # Path(__file__).parent crash with NameError without them (trap #3).
        d.setdefault("__file__", self.path)
        d.setdefault("__package__", self.fullname.rpartition(".")[0] or self.fullname)
        d["__CQ_EXPORT__"] = _export
        code = compile(tree, self.path, "exec")
        exec(code, module.__dict__)


class _Finder(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname not in TARGETS:
            return None
        tail = fullname.split(".")[-1] + ".py"
        for d in SYSDIRS:
            p = os.path.join(d, tail)
            if os.path.exists(p):
                return importlib.util.spec_from_loader(fullname, _Loader(fullname, p), origin=p)
        return None


sys.meta_path.insert(0, _Finder())


def pytest_unconfigure(config):
    mpath = os.path.join(OUT, "manifest.json")
    os.makedirs(OUT, exist_ok=True)
    with open(mpath, "w", encoding="utf-8") as f:
        json.dump(_manifest, f, indent=2)
    print(f"\n[cq_step_plugin] exported {len(_manifest)} cases -> {mpath}")
