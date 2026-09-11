// source: test_cadquery.py::TestCadQuery::testSweep (var cut)
// cut = box.vertices(">Z and >X and >Y").workplane(centerOption="CenterOfMass")
//       .circle(1.5).sweep(path, combine="cut"), path = Workplane("YZ").lineTo(10, 10)
// Upstream _sweep keeps the profile plane (horizontal, normal +Z) and translates
// it to the spine start, so the pipe is an oblique cylinder: a horizontal r1.5
// circle moved by (0,10,10) — vol pi*1.5^2*10 = 70.6858, exactly a ruled loft
// between the two end circles.
// ref (cadquery 2.8.0): vol 966.907092, bbox [-0,-1.5,-0]..[10,11.5,10]
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane(), 10, 10, 10, { centered: false })
let p0 = cq.Workplane('XY')
let p1 = await cq.transformed(p0, { offset: [10, 0, 0] })
let p2 = cq.circle(p1, 1.5)
let p3 = await cq.transformed(p2, { offset: [0, 10, 10] })
let p4 = cq.circle(p3, 1.5)
let pipe = await cq.loft(p4, { ruled: true })
let cutWp = await cq.cut(box, pipe)
let result = cq.val(cutWp)
