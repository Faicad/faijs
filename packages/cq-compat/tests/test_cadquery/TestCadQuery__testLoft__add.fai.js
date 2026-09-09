// source: test_cadquery.py::TestCadQuery::testLoft (var add)
// ref (cadquery 2.8.0): vol 1109.678117, 12 faces, bbox [-5,-5,-5]..[5,5,17]
//   add = box.faces(">Z").workplane().circle(2)
//         .workplane(offset=12).rect(3, 2).loft(combine=True)
//   sections: circle r2 at z=5, rect 3x2 at z=17 (offset along +Z)
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane(), 10, 10, 10)
let f = cq.faces(box, '>Z')
let w1 = await cq.workplane(f)
let w2 = cq.circle(w1, 2)
let w3 = await cq.workplane(w2, { offset: 12 })
let w4 = cq.rect(w3, 3, 2)
let add = await cq.loft(w4, { combine: true })
let result = cq.val(add)
