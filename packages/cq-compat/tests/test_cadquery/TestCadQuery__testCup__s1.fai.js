// source: test_cadquery.py::TestCadQuery::testCup (var s1)
// ref (cadquery 2.8.0): vol 40840.704497, 3 faces, bbox [-50,-50,0]..[50,50,10]
//   s1 = Workplane("XY").circle(bd=20).workplane(offset=h=10).circle(td=50).loft()
//   = truncated cone r20@z0 -> r50@z10
import * as cq from '@faicad/cq-compat'
let w1 = cq.circle(cq.Workplane('XY'), 20)
let w2 = await cq.workplane(w1, { offset: 10 })
let w3 = cq.circle(w2, 50)
let s1 = await cq.loft(w3)
let result = cq.val(s1)
