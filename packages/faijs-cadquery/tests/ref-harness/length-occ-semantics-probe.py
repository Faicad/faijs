#!/usr/bin/env python
"""One-shot reference capture: what does the REAL OpenCASCADE kernel report for
a linear (edge-length) measure on a solid?

Motivation (audit 2026-10-02-cadquery-port-gap-audit.md §3.1): the occt-wasm
`getLength` on a unit box returns 24, while summing the *unique* edges returns
12. Before calling that an occt-wasm bug, establish what the reference OCCT
kernel does — in particular `BRepGProp::LinearProperties` has a `SkipShared`
argument (added in OCCT 7.x) that controls whether an edge shared by two faces
is counted once or twice:

    BRepGProp::LinearProperties(S, Props, SkipShared=False, UseTriangulation=False)

If the real kernel's default also yields 24, then 24 is *genuine OCC default
semantics* (not an occt-wasm defect), and the question becomes a faijs semantic
choice. If the real kernel yields 12 by default, occt-wasm diverges and the
defect is on the occt-wasm side.

Runs in the cadquery-env interpreter (OCP = real OCCT), NOT in CI.

    C:/Users/ylt/cadquery-env/Scripts/python.exe length-occ-semantics-probe.py
"""

import json

from OCP.BRepGProp import BRepGProp
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox
from OCP.GProp import GProp_GProps
from OCP.TopoDS import TopoDS_Shape
from OCP.gp import gp_Pnt


def linear_props(shape, skip_shared=False):
    props = GProp_GProps()
    BRepGProp.LinearProperties_s(shape, props, skip_shared)
    return props.Mass()


def main():
    out = {}

    try:
        from OCP.Standard import Standard_Version
        out["occt_version"] = Standard_Version()
    except Exception as exc:  # pragma: no cover - version probe only
        out["occt_version"] = f"<unavailable: {exc}>"

    box = BRepPrimAPI_MakeBox(1.0, 1.0, 1.0).Shape()

    out["box_linearProps_default"] = linear_props(box)
    out["box_linearProps_skipShared_false"] = linear_props(box, False)
    out["box_linearProps_skipShared_true"] = linear_props(box, True)

    # Does TopoDS_Shape itself expose a Length()? (CadQuery's Shape.Length()
    # delegates to self.wrapped.Length() in some versions.)
    out["topods_has_Length"] = hasattr(TopoDS_Shape, "Length")
    out["box_has_Length"] = hasattr(box, "Length")
    if out["box_has_Length"]:
        out["box_Length()"] = box.Length()

    # CadQuery layer
    try:
        import cadquery as cq

        out["cadquery_version"] = cq.__version__
        solid = cq.Solid.makeBox(1, 1, 1)
        out["cq_solid_has_Length"] = hasattr(solid, "Length")
        if out["cq_solid_has_Length"]:
            out["cq_solid_Length"] = solid.Length()
        out["cq_solid_edges_count"] = len(solid.Edges())
        out["cq_solid_edge_len_sum"] = sum(e.Length() for e in solid.Edges())
    except Exception as exc:  # pragma: no cover - cadquery probe only
        out["cadquery_error"] = repr(exc)

    # Parametric solid (cylinder r=1 h=1): two circular edges, each shared by a
    # cap face and the lateral face. Unique sum = 2·2πr ≈ 12.566; per-face
    # default = 2× that. A second fingerprint of the SkipShared rule.
    from OCP.BRepPrimAPI import BRepPrimAPI_MakeCylinder

    cyl = BRepPrimAPI_MakeCylinder(1.0, 1.0).Shape()
    out["cylinder_linearProps_default"] = linear_props(cyl)
    out["cylinder_linearProps_skipShared_true"] = linear_props(cyl, True)

    # Two disjoint boxes as a compound (expect 24 under either counting rule's
    # per-face traversal, 24 unique edges total).
    b2 = BRepPrimAPI_MakeBox(gp_Pnt(5, 0, 0), 1.0, 1.0, 1.0).Shape()
    from OCP.TopoDS import TopoDS_Compound
    from OCP.BRep import BRep_Builder

    builder = BRep_Builder()
    comp = TopoDS_Compound()
    builder.MakeCompound(comp)
    builder.Add(comp, box)
    builder.Add(comp, b2)
    out["compound_linearProps_default"] = linear_props(comp)
    out["compound_linearProps_skipShared_true"] = linear_props(comp, True)

    print(json.dumps(out, indent=2, default=str))


if __name__ == "__main__":
    main()
