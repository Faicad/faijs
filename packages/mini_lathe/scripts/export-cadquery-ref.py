#!/usr/bin/env python3
"""
Export reference geometry from the ORIGINAL CadQuery mini_lathe project.

Usage:
    <cadquery-env>/Scripts/python.exe packages/mini_lathe/scripts/export-cadquery-ref.py [outDir]

Environment:
    MINI_LATHE_SRC   path to the original CadQuery project (default C:\\git\\CADQ\\mini_lathe)

Writes STEP files for all parts plus the solved assembly into <outDir>.
`cadquery.vis` is stubbed so part modules can be imported without opening a viewer.
"""

import os
import sys
import types

SRC = os.environ.get("MINI_LATHE_SRC", r"C:\git\CADQ\mini_lathe")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "out", "ref")
OUT = os.path.abspath(OUT)

sys.path.insert(0, SRC)

import cadquery as cq  # noqa: E402

# Stub cadquery.vis before importing part modules: several modules call
# show_object() / export() at import time (`if True or __name__ == "__main__"`).
_vis = types.ModuleType("cadquery.vis")
_vis.show = lambda *a, **k: None
_vis.show_object = lambda *a, **k: None
sys.modules["cadquery.vis"] = _vis
cq.vis = _vis

os.makedirs(OUT, exist_ok=True)
os.chdir(OUT)  # stray exports from module import land here, not in the source repo

import config  # noqa: E402,F401
import bottom_plate  # noqa: E402
import middle_bottom  # noqa: E402
import middle_top  # noqa: E402
import top_plate  # noqa: E402
import axk  # noqa: E402
import slide_top  # noqa: E402
import slide_mid  # noqa: E402

PARTS = {
    "bp": bottom_plate.bp,
    "mb": middle_bottom.mb,
    "mt": middle_top.mt,
    "tp": top_plate.tp,
    "axk": axk.axk,
    "slide_top": slide_top.slide_top,
    "slide_mid": slide_mid.slide_mid,
}

print("== parts ==")
for name, wp in PARTS.items():
    solids = len(wp.solids().vals())
    vol = sum(s.Volume() for s in wp.solids().vals())
    bb = wp.val().BoundingBox()
    path = os.path.join(OUT, name + ".step")
    cq.exporters.export(wp, name + ".step", exportType="STEP")
    print(
        f"{name:10s} solids={solids}  volume={vol:12.3f}  "
        f"bbox=({bb.xmin:.3f},{bb.ymin:.3f},{bb.zmin:.3f})..({bb.xmax:.3f},{bb.ymax:.3f},{bb.zmax:.3f})  -> {path}"
    )

print("== assembly ==")
# Mirrors assemb.py (parts + constraints). Rebuilt here because assemb.py calls
# show_object() at module scope.
lathe = (
    cq.Assembly()
    .add(axk.axk, name="axk", color=cq.Color(0.3, 0.3, 0.3, 1.0))
    .add(bottom_plate.bp, name="bp", color=cq.Color(0.8, 0.5, 0.1, 1))
    .add(middle_bottom.mb, name="mb", color=cq.Color(0.1, 0.7, 0.7, 1.0))
    .add(middle_top.mt, name="mt", color=cq.Color(0.0, 0.9, 0.8, 1.0))
    .add(top_plate.tp, name="tp", color=cq.Color(1.0, 0.7, 0.2, 1))
    .add(slide_top.slide_top, name="slide_top", color=cq.Color(1.0, 0.7, 0.2, 1))
)

(
    lathe
    .constrain("bp@faces@>Z[-2]", "mb@faces@<Z", "Plane")
    .constrain("mb@faces@>Z[-2]", "mt@faces@<Z", "Plane")
    .constrain("mt@faces@>Z", "tp@faces@>Z[-2]", "Plane")
    .constrain("bp@faces@<X", "mb@faces@<X", "Axis")
    .constrain("bp@faces@<X", "mt@faces@<X", "Axis")
    .constrain("bp@faces@<X", "tp@faces@<X", "Axis")
    .constrain("bp@faces@<Z", "axk@faces@>Z", "Plane")
    .constrain("bp@faces@<X", "axk@faces@<X", "Axis")
)

lathe.solve()
bbox = lathe.toCompound().BoundingBox()
print(f"assembly zlen: {bbox.zlen:.3f}")
print(f"assembly zlen: {bbox.zlen:.3f}")

# (per-part poses come from compare-assembly.ts; solve() drops the .obj refs)
asm_path = os.path.join(OUT, "mini_lathe.step")
lathe.save(asm_path, exportType="STEP")
print(f"assembly -> {asm_path}")
