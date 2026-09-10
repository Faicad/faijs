// source: test_cadquery.py::TestCadQuery::testTangentArcToPoint (var s1, FINAL
// value — upstream reassigns s1; the exported one is the relative-coords /
// consecutive-arcs variant)
// s1 = Workplane("XY").vLine(2).tangentArcPoint((1,0)).tangentArcPoint((1,0))
//      .tangentArcPoint((1,0)).vLine(-2).close().extrude(1)
// ref (probed): vol 6.392699 (= 6 + pi/8 — three half-circle bulges alternate
// above/below the y=2 line), 8 faces.
// Requires chaining the END TANGENT of each tangent arc (analytic: the sweep
// side comes from which side of the travel direction the circle center sits).
import * as cq from '@faicad/cq-compat'
let w0 = await cq.vLine(cq.Workplane('XY'), 2)
let w1 = await cq.tangentArcPoint(w0, [1, 0])
let w2 = await cq.tangentArcPoint(w1, [1, 0])
let w3 = await cq.tangentArcPoint(w2, [1, 0])
let w4 = await cq.vLine(w3, -2)
let w5 = await cq.close(w4)
let s1 = await cq.extrude(w5, 1)
let result = cq.val(s1)
