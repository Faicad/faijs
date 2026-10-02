"""
One-shot CadQuery 2.8.0 reference capture for Shape introspection queries.

Purpose (see docs/plans/2026-10-02-cadquery-port-gap-audit.md §5.1): capture
the GROUND TRUTH values of CadQuery's value/metadata query methods
(Volume / Area / Length / Center / BoundingBox / isValid / geomType) on a
small set of canonical fixtures, so they can be frozen as hard-coded
expectations in src/shape-class.test.ts.

This script is ONE-SHOT — it is NOT part of CI and must NOT be wired into any
per-test / per-run probe channel. Re-run it manually only when the fixture set
or CadQuery version changes, then refresh the assertions.

Run:
    /c/Users/ylt/cadquery-env/Scripts/python.exe \
        packages/faijs-cadquery/tests/ref-harness/shape-introspection-probe.py
"""

import cadquery as cq
import json


def edge_length(shape):
    # CadQuery 2.8.0 lacks a uniform Shape.Length(); sum the edges instead.
    # (An Edge's Edges() yields itself, so this also works for an edge.)
    return sum(e.Length() for e in shape.Edges())


def probe(label, shape):
    bb = shape.BoundingBox()
    center = shape.Center()
    rec = {
        "label": label,
        "geomType": shape.geomType(),
        "isValid": bool(shape.isValid()),
        "volume": shape.Volume(),
        "area": shape.Area(),
        "length": edge_length(shape),
        "center": [center.x, center.y, center.z],
        "bbox": [bb.xmin, bb.xmax, bb.ymin, bb.ymax, bb.zmin, bb.zmax],
    }
    return rec


def main():
    # Unit box from origin to (1,1,1) — matches occt-wasm makeBox(1,1,1).
    box = cq.Solid.makeBox(1, 1, 1)
    # Same box translated by +5 along X.
    box_t = box.moved(cq.Location(cq.Vector(5, 0, 0)))
    # One face of the box (1x1 square).
    face = box.Faces()[0]
    # One edge of the box (unit edge).
    edge = box.Edges()[0]

    records = [
        probe("box_solid", box),
        probe("box_solid_translated", box_t),
        probe("box_face", face),
        probe("box_edge", edge),
    ]

    print(json.dumps(records, indent=2))


if __name__ == "__main__":
    main()
