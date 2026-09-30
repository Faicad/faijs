// source: test_cadquery.py::TestCadQuery::testTextAlignment (var right_top)
// right_top = Workplane().text("I", 10, 0, halign="right", valign="top", fontPath=testFont)
import * as cq from '@faicad/cq-compat'
let right_top = await cq.text(cq.Workplane('XY'), 'I', 10, 0, 'cut', {
  halign: 'right',
  valign: 'top',
  fontPath: 'OpenSans-Regular.ttf',
})
let result = cq.val(right_top)
