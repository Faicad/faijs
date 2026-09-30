// source: test_cadquery.py::TestCadQuery::testText (var obj4)
// obj4 = box.faces(">Z").workplane().text("CQ 2.0", 0.5, 0.05, fontPath=testFont,
//            combine=False, halign="right", valign="top", font="Sans")
// testFont == OpenSans-Regular.ttf (== the engine's default face).
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane('XY'), 4, 4, 0.5)
let top_wp = await cq.workplane(cq.faces(box, '>Z'))
let obj4 = await cq.text(top_wp, 'CQ 2.0', 0.5, 0.05, false, {
  halign: 'right',
  valign: 'top',
  font: 'Sans',
  fontPath: 'OpenSans-Regular.ttf',
})
let result = cq.val(obj4)
