// source: test_cadquery.py::TestCadQuery::testText (var obj3)
// obj3 = box.faces(">Z").workplane().text("CQ 2.0", 0.5, 0.05, combine=False,
//            halign="right", valign="top", font="Sans")
import * as cq from '@faicad/faijs-cadquery'
let box = await cq.box(cq.Workplane('XY'), 4, 4, 0.5)
let top_wp = await cq.workplane(cq.faces(box, '>Z'))
let obj3 = await cq.text(top_wp, 'CQ 2.0', 0.5, 0.05, false, {
  halign: 'right',
  valign: 'top',
  font: 'Sans',
})
let result = cq.val(obj3)
