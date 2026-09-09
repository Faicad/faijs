// source: test_cadquery.py::TestCadQuery::testDoubleTwistedLoft (var s2)
// ref (cadquery 2.8.0): vol 1118.520674, 10 faces, bbox [-10,-10,-4]..[10,10,0]
//   s2 = Workplane("XY").polygon(8, 20.0).workplane(offset=-4.0)
//        .transformed(rotate=Vector(0, 0, 15.0)).polygon(8, 20).loft()
//   (second loft extends downward: offset=-4)
import * as cq from '@faicad/cq-compat'
let w1 = cq.polygon(cq.Workplane('XY'), 8, 20)
let w2 = await cq.workplane(w1, { offset: -4 })
let w3 = await cq.transformed(w2, { rotate: [0, 0, 15] })
let w4 = cq.polygon(w3, 8, 20)
let s2 = await cq.loft(w4)
let result = cq.val(s2)
