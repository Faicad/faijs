// source: test_cadquery.py::TestCadQuery::testMultisectionSweep (var recttocircleSweep)
// recttocircleSweep = Workplane("YZ").workplane(offset=-10).rect(2,2)
//   .workplane(offset=8).circle(1).workplane(offset=4).circle(1)
//   .workplane(offset=8).rect(2,2).sweep(path, multisection=True)
// Straight spine along X; sections at x=-10,-2,2,10 as-is, so the multisection
// sweep equals a smooth loft through them.
// ref (cadquery 2.8.0): vol 68.21873503586079
import * as cq from '@faicad/cq-compat'
let w0 = cq.Workplane('YZ')
let w1 = await cq.workplane(w0, { offset: -10 })
let w2 = cq.rect(w1, 2, 2)
let w3 = await cq.workplane(w2, { offset: 8 })
let w4 = cq.circle(w3, 1)
let w5 = await cq.workplane(w4, { offset: 4 })
let w6 = cq.circle(w5, 1)
let w7 = await cq.workplane(w6, { offset: 8 })
let w8 = cq.rect(w7, 2, 2)
let recttocircleSweep = await cq.loft(w8)
let result = cq.val(recttocircleSweep)
