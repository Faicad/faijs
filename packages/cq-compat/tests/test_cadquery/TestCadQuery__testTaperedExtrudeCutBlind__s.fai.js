// source: test_cadquery.py::TestCadQuery::testTaperedExtrudeCutBlind (var s)
// Final s of the test (harness captures last locals):
//   s = Workplane("XY").rect(2*r, 2*r).extrude(2*h)      # r=1, h=1
//         .faces(">Z").workplane().rect(r, r).cutBlind(-h, taper=5)
// Tapered rectangular pocket into a 2x2x2 block; pocket opening 1x1 at the
// top face, narrowing 5 deg to depth 1 (vol 8 - 0.835 = 7.165... ref 7.2).
// ref (probed): Solid, vol 7.2, 11 faces.
import * as cq from '@faicad/cq-compat'
let w0 = await cq.rect(cq.Workplane('XY'), 2.0, 2.0)
let b0 = await cq.extrude(w0, 2.0)
let f0 = await cq.faces(b0, '>Z')
let wp1 = await cq.workplane(f0)
let w1 = await cq.rect(wp1, 1.0, 1.0)
let s = await cq.cutBlind(w1, -1.0, { taper: 5.0 })
let result = cq.val(s)
