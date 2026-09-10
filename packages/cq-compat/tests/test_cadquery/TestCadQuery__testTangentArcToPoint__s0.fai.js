// source: test_cadquery.py::TestCadQuery::testTangentArcToPoint (var s0)
// s0 = Workplane("XY").hLine(1)
//      .tangentArcPoint((1,1), relative=False).hLineTo(0)
//      .tangentArcPoint((0,0), relative=False).close().extrude(1)
// ref (probed): vol 1.785398 (= 1 + pi/4), com (0.5, 0.5, 0.5), 6 faces.
// tangentArcPoint continues the tangent of the LAST drafted edge; the two
// arcs here are quarter circles.
import * as cq from '@faicad/cq-compat'
let w0 = await cq.hLine(cq.Workplane('XY'), 1)
let w1 = await cq.tangentArcPoint(w0, [1, 1], false, false)
let w2 = await cq.hLineTo(w1, 0)
let w3 = await cq.tangentArcPoint(w2, [0, 0], false, false)
let w4 = await cq.close(w3)
let s0 = await cq.extrude(w4, 1)
let result = cq.val(s0)
