// source: test_cadquery.py::TestCadQuery::testSimpleMirror (var s, final state)
// s = Workplane("XY").lineTo(2, 2).threePointArc((3, 1), (2, 0)).mirrorX().extrude(0.25)
// Upstream docstring: "Produces a flat, heart shaped object".
// mirrorX mirrors about the workplane X AXIS (local y → −y), so the profile
// drafted in y ≥ 0 gains its y ≤ 0 twin and extrude closes them into one solid.
// ref (probed): vol 1.78539816340, bbox x[0,3] y[-2,2] z[0,0.25], f6/e12/v8.
import * as cq from '@faicad/faijs-cadquery'
let w0 = cq.Workplane('XY')
let w1 = await cq.lineTo(w0, 2, 2)
let w2 = await cq.threePointArc(w1, [3, 1], [2, 0])
let w3 = await cq.mirrorX(w2)
let s = await cq.extrude(w3, 0.25)
let result = cq.val(s)
