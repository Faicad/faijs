// source: test_cadquery.py::TestCadQuery::testTextAlignment (var left_bottom)
// left_bottom = Workplane().text("I", 10, 0, halign="left", valign="bottom", fontPath=testFont)
import * as cq from '@faicad/cq-compat'
let left_bottom = await cq.text(cq.Workplane('XY'), 'I', 10, 0, 'cut', {
  halign: 'left',
  valign: 'bottom',
  fontPath: 'OpenSans-Regular.ttf',
})
let result = cq.val(left_bottom)
