// source: test_cadquery.py::TestCadQuery::testMultisectionSweep (var defaultSweep)
// defaultSweep = Workplane("YZ").workplane(offset=-10).circle(2)
//   .workplane(offset=10).circle(1).workplane(offset=10).circle(2)
//   .sweep(path, multisection=True), path = Workplane("XZ").moveTo(-10,0).lineTo(10,0)
// Straight spine along X with all sections already positioned perpendicular to
// it, so the multisection sweep equals a smooth loft through the three circles
// (ref vol reproduced exactly by as-is loft).
// ref (cadquery 2.8.0): vol 117.28612488370534
import * as cq from '@faicad/cq-compat'
let w0 = cq.Workplane('YZ')
let w1 = await cq.workplane(w0, { offset: -10 })
let w2 = cq.circle(w1, 2)
let w3 = await cq.workplane(w2, { offset: 10 })
let w4 = cq.circle(w3, 1)
let w5 = await cq.workplane(w4, { offset: 10 })
let w6 = cq.circle(w5, 2)
let defaultSweep = await cq.loft(w6)
let result = cq.val(defaultSweep)
