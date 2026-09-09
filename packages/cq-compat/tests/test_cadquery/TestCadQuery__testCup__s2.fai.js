// source: test_cadquery.py::TestCadQuery::testCup (var s2)
// ref (cadquery 2.8.0): vol 32911.324639, 3 faces, bbox [-48,-48,1]..[48,48,10]
//   s2 = Workplane("XY").workplane(offset=t=1).circle(bd-2t=18)
//        .workplane(offset=h-t=9).circle(td-2t=48).loft()
//   = truncated cone r18@z1 -> r48@z10 (workplane offsets stack)
import * as cq from '@faicad/cq-compat'
let w1 = await cq.workplane(cq.Workplane('XY'), { offset: 1 })
let w2 = cq.circle(w1, 18)
let w3 = await cq.workplane(w2, { offset: 9 })
let w4 = cq.circle(w3, 48)
let s2 = await cq.loft(w4)
let result = cq.val(s2)
