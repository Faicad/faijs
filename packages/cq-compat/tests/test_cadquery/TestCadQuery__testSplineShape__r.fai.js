// source: test_cadquery.py::TestCadQuery::testSplineShape (var r)
// sPnts = [(2.75,1.5),(2.5,1.75),(2.0,1.5),(1.5,1.0),(1.0,1.25),(0.5,1.0),(0,1.0)]
// r = Workplane("XY").lineTo(3,0).lineTo(3,1).spline(sPnts).close().extrude(0.5)
// Upstream quirk (measured, cadquery 2.8.0): spline's includeCurrent default is
// FALSE, so the spline edge starts at (2.75,1.5) — 0.35 away from the line end
// (3,1). BRepBuilderAPI_MakeWire reports NotDone but upstream keeps the wire
// anyway, and MakeFace/MakePrism tolerate the gap: solid with 6 faces,
// vol 1.5054720953140648. The mirror reproduces the same chain.
// ref (probed): vol 1.5054720953140648.
import * as cq from '@faicad/cq-compat'
let sPnts = [[2.75, 1.5], [2.5, 1.75], [2.0, 1.5], [1.5, 1.0], [1.0, 1.25], [0.5, 1.0], [0, 1.0]]
let w0 = await cq.lineTo(cq.Workplane('XY'), 3, 0)
let w1 = await cq.lineTo(w0, 3, 1)
let w2 = await cq.spline(w1, sPnts)
let w3 = await cq.close(w2)
let r = await cq.extrude(w3, 0.5)
let result = cq.val(r)
