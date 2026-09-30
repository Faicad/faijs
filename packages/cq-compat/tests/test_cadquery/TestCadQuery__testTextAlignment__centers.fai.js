// source: test_cadquery.py::TestCadQuery::testTextAlignment (var centers)
// centers = Workplane().text("I", 10, 0, halign="center", valign="center", fontPath=testFont)
import * as cq from '@faicad/cq-compat'
let centers = await cq.text(cq.Workplane('XY'), 'I', 10, 0, 'cut', {
  halign: 'center',
  valign: 'center',
  fontPath: 'OpenSans-Regular.ttf',
})
let result = cq.val(centers)
