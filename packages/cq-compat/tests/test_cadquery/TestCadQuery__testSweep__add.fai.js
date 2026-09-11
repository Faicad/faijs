// source: test_cadquery.py::TestCadQuery::testSweep (var add)
// add = box.vertices(">Z and >X and >Y").workplane(centerOption="CenterOfMass")
//       .circle(1.5).sweep(path, combine=True), path = Workplane("YZ").lineTo(10, 10)
// Same oblique-cylinder pipe as the cut case (horizontal r1.5 circle translated
// by (0,10,10) = ruled loft between the end circles), fused with the box.
// ref (cadquery 2.8.0): vol 1037.592928, bbox [-0,-1.5,-0]..[11.5,11.5,10]
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane(), 10, 10, 10, { centered: false })
let p0 = cq.Workplane('XY')
let p1 = await cq.transformed(p0, { offset: [10, 0, 0] })
let p2 = cq.circle(p1, 1.5)
let p3 = await cq.transformed(p2, { offset: [0, 10, 10] })
let p4 = cq.circle(p3, 1.5)
let pipe = await cq.loft(p4, { ruled: true })
let addWp = await cq.union(box, pipe)
let result = cq.val(addWp)
