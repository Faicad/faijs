// source: test_free_functions.py::test_text (var r4)
// r4 = text("CQ", 10, valign="bottom")
// Flat glyph faces (distance = 0); see test_text__r1.fai.js for the font note.
import * as cq from '@faicad/faijs-cadquery'
let r4 = await cq.text(cq.Workplane('XY'), 'CQ', 10, 0, false, {
  valign: 'bottom',
  font: 'Arial',
})
let result = cq.val(r4)
