// source: test_cadquery.py::TestCadQuery::testDoubleTwistedLoft (var s)
// ref (cadquery 2.8.0): vol 1118.520674, 10 faces, bbox [-10,-10,0]..[10,10,4]
//   s = Workplane("XY").polygon(8, 20.0).workplane(offset=4.0)
//       .transformed(rotate=Vector(0, 0, 15.0)).polygon(8, 20).loft()
//   (same geometry as testTwistedLoft__s — s of the double-twist test)
import * as cq from '@faicad/cq-compat'
let w1 = cq.polygon(cq.Workplane('XY'), 8, 20)
let w2 = await cq.workplane(w1, { offset: 4 })
let w3 = await cq.transformed(w2, { rotate: [0, 0, 15] })
let w4 = cq.polygon(w3, 8, 20)
let s = await cq.loft(w4)
let result = cq.val(s)
