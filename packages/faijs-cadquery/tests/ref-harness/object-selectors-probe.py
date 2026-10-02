"""
One-shot CadQuery 2.8.0 reference capture for the OBJECT SELECTOR CLASSES
(BoxSelector / CenterNthSelector / RadiusNthSelector / LengthNthSelector /
AreaNthSelector / NearestToShapeSelector / And-Sum-Subtract-Inverse).

Purpose (see docs/plans/2026-10-02-cadquery-port-gap-audit.md §5.1): capture
the GROUND TRUTH of selectors whose output is a *sub-shape reference* — never
an exported STEP — so it can be frozen as hard-coded expectations in
src/object-selectors.test.ts.

This script is ONE-SHOT — it is NOT part of CI and must NOT be wired into any
per-test / per-run probe channel. Re-run it manually only when the fixture set
or the CadQuery version changes, then refresh the assertions.

Run:
    /c/Users/ylt/cadquery-env/Scripts/python.exe \
        packages/faijs-cadquery/tests/ref-harness/object-selectors-probe.py
"""

import json

import cadquery as cq
from cadquery.selectors import (
    AndSelector,
    AreaNthSelector,
    BoxSelector,
    CenterNthSelector,
    InverseSelector,
    LengthNthSelector,
    NearestToShapeSelector,
    RadiusNthSelector,
    Selector,
    SubtractSelector,
    SumSelector,
)


def ident(shapes):
    """Deterministic identity of a selection result: (ShapeType, Center).

    Python's set-based binary selectors return an arbitrary order, so results
    are always sorted before comparison.
    """
    out = []
    for s in shapes:
        c = s.Center()
        out.append([s.ShapeType(), round(c.x, 7), round(c.y, 7), round(c.z, 7)])
    out.sort(key=lambda r: (r[0], r[1], r[2], r[3]))
    return out


def bbox(shape):
    bb = shape.BoundingBox()
    return [round(v, 7) for v in (bb.xmin, bb.xmax, bb.ymin, bb.ymax, bb.zmin, bb.zmax)]


def cap(label, fn):
    try:
        res = fn()
        print(json.dumps({"label": label, "ok": True, "result": res}))
    except Exception as e:  # noqa: BLE001 - capture is the point
        print(json.dumps({"label": label, "ok": False, "error": "%s: %s" % (type(e).__name__, e)}))


def main():
    # ------------------------------------------------------------------
    # Fixture A: 20 x 10 x 2 box with a corner at the origin
    # (matches occt-wasm makeBox(20, 10, 2)).
    # ------------------------------------------------------------------
    plate = cq.Solid.makeBox(20, 10, 2)
    faces = list(plate.Faces())
    edges = list(plate.Edges())
    verts = list(plate.Vertices())

    print(json.dumps({"label": "fixture.plate", "ok": True, "result": {
        "bbox": bbox(plate),
        "nFaces": len(faces), "nEdges": len(edges), "nVertices": len(verts),
        "faceAreas": sorted(round(f.Area(), 7) for f in faces),
        "edgeLengths": sorted(round(e.Length(), 7) for e in edges),
        "faceCenters": ident(faces),
        "vertexCenters": ident(verts),
    }}))

    cap("lengthNth.edges.n0", lambda: ident(LengthNthSelector(0).filter(edges)))
    cap("lengthNth.edges.n1", lambda: ident(LengthNthSelector(1).filter(edges)))
    cap("lengthNth.edges.n-1", lambda: ident(LengthNthSelector(-1).filter(edges)))
    cap("lengthNth.edges.n0.min", lambda: ident(LengthNthSelector(0, False).filter(edges)))
    cap("lengthNth.edges.n3", lambda: ident(LengthNthSelector(3).filter(edges)))
    cap("lengthNth.faces.n0", lambda: ident(LengthNthSelector(0).filter(faces)))
    cap("lengthNth.empty", lambda: ident(LengthNthSelector(0).filter([])))

    cap("areaNth.faces.n0", lambda: ident(AreaNthSelector(0).filter(faces)))
    cap("areaNth.faces.n1", lambda: ident(AreaNthSelector(1).filter(faces)))
    cap("areaNth.faces.n-1", lambda: ident(AreaNthSelector(-1).filter(faces)))
    cap("areaNth.faces.n2", lambda: ident(AreaNthSelector(2).filter(faces)))
    cap("areaNth.edges.n0", lambda: ident(AreaNthSelector(0).filter(edges)))

    cap("centerNth.faces.x.n0", lambda: ident(CenterNthSelector(cq.Vector(1, 0, 0), 0).filter(faces)))
    cap("centerNth.faces.x.n1", lambda: ident(CenterNthSelector(cq.Vector(1, 0, 0), 1).filter(faces)))
    cap("centerNth.faces.x.n-1", lambda: ident(CenterNthSelector(cq.Vector(1, 0, 0), -1).filter(faces)))
    cap("centerNth.faces.x.n0.min", lambda: ident(CenterNthSelector(cq.Vector(1, 0, 0), 0, False).filter(faces)))
    cap("centerNth.faces.z.n0", lambda: ident(CenterNthSelector(cq.Vector(0, 0, 1), 0).filter(faces)))
    cap("centerNth.faces.z.n-1", lambda: ident(CenterNthSelector(cq.Vector(0, 0, 1), -1).filter(faces)))
    cap("centerNth.faces.x2.n1", lambda: ident(CenterNthSelector(cq.Vector(2, 0, 0), 1).filter(faces)))
    cap("centerNth.verts.xy.n0", lambda: ident(CenterNthSelector(cq.Vector(1, 1, 0), 0).filter(verts)))
    cap("centerNth.verts.xy.n-1", lambda: ident(CenterNthSelector(cq.Vector(1, 1, 0), -1).filter(verts)))

    # BoxSelector — centre mode (XOR test, order of the two points irrelevant).
    cap("box.center.verts.A", lambda: ident(BoxSelector((0, 0, 0), (10, 5, 1)).filter(verts)))
    cap("box.center.verts.A.rev", lambda: ident(BoxSelector((10, 5, 1), (0, 0, 0)).filter(verts)))
    cap("box.center.verts.B", lambda: ident(BoxSelector((-1, -1, -1), (10, 5, 3)).filter(verts)))
    cap("box.center.verts.all", lambda: ident(BoxSelector((-1, -1, -1), (21, 11, 3)).filter(verts)))
    cap("box.center.faces.A", lambda: ident(BoxSelector((0, 0, 0), (10, 10, 2)).filter(faces)))

    # BoxSelector — boundingbox mode (both bbox corners must be inside).
    cap("box.bb.faces.exact", lambda: ident(BoxSelector((0, 0, 0), (20, 10, 2), True).filter(faces)))
    cap("box.bb.faces.padded", lambda: ident(BoxSelector((-1e-3, -1e-3, -1e-3), (20 + 1e-3, 10 + 1e-3, 2 + 1e-3), True).filter(faces)))
    cap("box.bb.faces.half", lambda: ident(BoxSelector((-1e-3, -1e-3, -1e-3), (10 + 1e-3, 10 + 1e-3, 2 + 1e-3), True).filter(faces)))
    cap("box.bb.verts.A", lambda: ident(BoxSelector((0, 0, 0), (10, 5, 1), True).filter(verts)))

    # Binary selectors.
    cap("sum.verts", lambda: ident(
        SumSelector(BoxSelector((0, 0, 0), (10, 5, 1)), BoxSelector((15, 6, 1.5), (21, 11, 3))).filter(verts)))
    cap("and.verts", lambda: ident(
        AndSelector(BoxSelector((-1, -1, -1), (21, 11, 3)), BoxSelector((0, 0, 0), (10, 5, 1))).filter(verts)))
    cap("subtract.verts", lambda: ident(
        SubtractSelector(BoxSelector((-1, -1, -1), (21, 11, 3)), BoxSelector((0, 0, 0), (10, 5, 1))).filter(verts)))
    cap("inverse.faces.bottom", lambda: ident(
        InverseSelector(CenterNthSelector(cq.Vector(0, 0, 1), 0)).filter(faces)))
    cap("subtract.all.minus.bottom", lambda: ident(
        SubtractSelector(Selector(), CenterNthSelector(cq.Vector(0, 0, 1), 0)).filter(faces)))

    # ------------------------------------------------------------------
    # Fixture B: circle edges (RadiusNthSelector)
    # ------------------------------------------------------------------
    c1 = cq.Edge.makeCircle(1)
    c2 = cq.Edge.makeCircle(2, pnt=cq.Vector(10, 0, 0))
    c3 = cq.Edge.makeCircle(3, pnt=cq.Vector(20, 0, 0))
    line = cq.Edge.makeLine(cq.Vector(0, 0, 0), cq.Vector(5, 0, 0))
    circles = [c1, c2, c3]

    print(json.dumps({"label": "fixture.circles", "ok": True, "result": {
        "radii": [c.radius() for c in circles],
        "lengths": [round(c.Length(), 7) for c in circles],
        "centers": ident(circles),
        "lineLength": round(line.Length(), 7),
    }}))

    cap("radiusNth.n0", lambda: ident(RadiusNthSelector(0).filter(circles)))
    cap("radiusNth.n1", lambda: ident(RadiusNthSelector(1).filter(circles)))
    cap("radiusNth.n-1", lambda: ident(RadiusNthSelector(-1).filter(circles)))
    cap("radiusNth.n0.min", lambda: ident(RadiusNthSelector(0, False).filter(circles)))
    cap("radiusNth.withLine.n-1", lambda: ident(RadiusNthSelector(-1).filter(circles + [line])))
    cap("radiusNth.lineOnly.n0", lambda: ident(RadiusNthSelector(0).filter([line])))
    cap("radiusNth.faces.n0", lambda: ident(RadiusNthSelector(0).filter(faces)))

    # ------------------------------------------------------------------
    # Fixture C: two-hole plate — the realistic upstream usage
    # ------------------------------------------------------------------
    cyl1 = cq.Solid.makeCylinder(0.5, 4, pnt=cq.Vector(5, 5, -1))
    cyl2 = cq.Solid.makeCylinder(1.5, 4, pnt=cq.Vector(14, 5, -1))
    holed = plate.cut(cyl1).cut(cyl2)
    hole_edges = [e for e in holed.Edges() if e.geomType() == "CIRCLE"]

    print(json.dumps({"label": "fixture.holed", "ok": True, "result": {
        "bbox": bbox(holed),
        "volume": round(holed.Volume(), 7),
        "nEdges": len(holed.Edges()),
        "circleEdgeRadii": sorted(round(e.radius(), 7) for e in hole_edges),
        "circleEdgeCenters": ident(hole_edges),
    }}))

    cap("radiusNth.holes.n0", lambda: ident(RadiusNthSelector(0).filter(hole_edges)))
    cap("radiusNth.holes.n-1", lambda: ident(RadiusNthSelector(-1).filter(hole_edges)))

    # ------------------------------------------------------------------
    # Fixture D: NearestToShapeSelector
    # ------------------------------------------------------------------
    ref = cq.Solid.makeBox(1, 1, 1)
    near = cq.Solid.makeBox(1, 1, 1, pnt=cq.Vector(5, 0, 0))
    far = cq.Solid.makeBox(1, 1, 1, pnt=cq.Vector(12, 0, 0))
    print(json.dumps({"label": "fixture.nearest", "ok": True, "result": {
        "refBBox": bbox(ref), "nearBBox": bbox(near), "farBBox": bbox(far),
        "distNear": ref.distance(near), "distFar": ref.distance(far),
    }}))

    cap("nearestToShape.solids", lambda: ident(NearestToShapeSelector(ref).filter([far, near])))
    cap("nearestToShape.solids.rev", lambda: ident(NearestToShapeSelector(ref).filter([near, far])))
    cap("nearestToShape.vertices", lambda: ident(NearestToShapeSelector(cq.Vertex.makeVertex(0, 0, 0)).filter(
        [cq.Vertex.makeVertex(7, 0, 0), cq.Vertex.makeVertex(2, 0, 0), cq.Vertex.makeVertex(5, 0, 0)])))
    # GOTCHA: a reference vertex at (0, 0, 50) TIES the -X and +Z faces (both
    # reach the shared corner (0, 0, 2)), so `min` would depend on face order.
    # The (-10, 5, 1) reference breaks the tie: -X is at distance 10, +Z at
    # sqrt(101) ≈ 10.05, -Y at sqrt(125) ≈ 11.18.
    cap("nearestToShape.faces", lambda: ident(NearestToShapeSelector(cq.Vertex.makeVertex(-10, 5, 1)).filter(faces)))
    cap("nearestToShape.empty", lambda: ident(NearestToShapeSelector(ref).filter([])))
    cap("nearestToShape.tie", lambda: ident(NearestToShapeSelector(cq.Vertex.makeVertex(0, 0, 50)).filter(faces)))


if __name__ == "__main__":
    main()
