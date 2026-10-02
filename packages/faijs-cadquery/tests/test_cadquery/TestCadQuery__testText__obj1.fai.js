// source: test_cadquery.py::TestCadQuery::testText (var obj1)
// obj1 = box.faces(">Z").workplane().text("CQ 2.0", 0.5, -0.05,
//            halign="left", valign="bottom", font="Sans")
// combine defaults to "cut" (upstream CombineMode default).
import * as cq from '@faicad/faijs-cadquery'
let box = await cq.box(cq.Workplane('XY'), 4, 4, 0.5)
let top_wp = await cq.workplane(cq.faces(box, '>Z'))
let obj1 = await cq.text(top_wp, 'CQ 2.0', 0.5, -0.05, 'cut', {
  halign: 'left',
  valign: 'bottom',
  font: 'Sans',
})
let result = cq.val(obj1)
