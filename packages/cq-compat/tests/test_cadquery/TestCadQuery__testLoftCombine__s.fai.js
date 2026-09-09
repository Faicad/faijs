// source: test_cadquery.py::TestCadQuery::testLoftCombine (var s)
// ref (cadquery 2.8.0): vol 13.103551, 12 faces, bbox [-2,-2,-0.125]..[2,2,3.125]
//   s = Workplane("front").box(4,4,0.25).faces(">Z").circle(1.5)
//       .workplane(offset=3.0).rect(0.75,0.5).loft(combine=True)
//   ("front" == XY in cadquery Plane.named; sections: circle r1.5 at z=0.125,
//    rect 0.75x0.5 at z=3.125)
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane('front'), 4, 4, 0.25)
let f = cq.faces(box, '>Z')
let w1 = await cq.workplane(f)
let w2 = cq.circle(w1, 1.5)
let w3 = await cq.workplane(w2, { offset: 3 })
let w4 = cq.rect(w3, 0.75, 0.5)
let s = await cq.loft(w4, { combine: true })
let result = cq.val(s)
