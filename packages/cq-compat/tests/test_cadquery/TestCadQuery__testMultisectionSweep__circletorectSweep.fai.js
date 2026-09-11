// source: test_cadquery.py::TestCadQuery::testMultisectionSweep (var circletorectSweep)
// circletorectSweep = Workplane("YZ").workplane(offset=-10).circle(1)
//   .workplane(offset=7).rect(2,2).workplane(offset=6).rect(2,2)
//   .workplane(offset=7).circle(1).sweep(path, multisection=True)
// Straight spine along X; sections at x=-10,-3,3,10 as-is, so the multisection
// sweep equals a smooth loft through them.
// ref (cadquery 2.8.0): vol 75.51717828365719
import * as cq from '@faicad/cq-compat'
let w0 = cq.Workplane('YZ')
let w1 = await cq.workplane(w0, { offset: -10 })
let w2 = cq.circle(w1, 1)
let w3 = await cq.workplane(w2, { offset: 7 })
let w4 = cq.rect(w3, 2, 2)
let w5 = await cq.workplane(w4, { offset: 6 })
let w6 = cq.rect(w5, 2, 2)
let w7 = await cq.workplane(w6, { offset: 7 })
let w8 = cq.circle(w7, 1)
let circletorectSweep = await cq.loft(w8)
let result = cq.val(circletorectSweep)
