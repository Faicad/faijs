// source: test_cadquery.py::TestCadQuery::testText (var obj2)
// obj2 = box.faces(">Z").workplane().text("CQ 2.0", 0.5, 0.05, combine=True, font="Sans")
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane('XY'), 4, 4, 0.5)
let top_wp = await cq.workplane(cq.faces(box, '>Z'))
let obj2 = await cq.text(top_wp, 'CQ 2.0', 0.5, 0.05, true, { font: 'Sans' })
let result = cq.val(obj2)
