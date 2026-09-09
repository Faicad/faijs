// source: test_cadquery.py::TestCadQuery::testLoft (var cut)
// ref (cadquery 2.8.0): vol 903.288863, 11 faces, bbox [-5,-5,-7]..[5,5,5]
//   cut = box.faces(">Z").workplane().circle(2)
//         .workplane(invert=True, offset=12).rect(3, 2).loft(combine="cut")
//   sections: circle r2 at z=5 (top face), rect 3x2 at z=-7 (inverted plane)
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane(), 10, 10, 10)
let f = cq.faces(box, '>Z')
let w1 = await cq.workplane(f)
let w2 = cq.circle(w1, 2)
let w3 = await cq.workplane(w2, { invert: true, offset: 12 })
let w4 = cq.rect(w3, 3, 2)
let cut = await cq.loft(w4, { combine: 'cut' })
let result = cq.val(cut)
