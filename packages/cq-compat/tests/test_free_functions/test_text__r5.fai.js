// source: test_free_functions.py::test_text (var r5)
// r5 = text("CQ", 10, valign="top")
// Flat glyph faces (distance = 0); see test_text__r1.fai.js for the font note.
import * as cq from '@faicad/cq-compat'
let r5 = await cq.text(cq.Workplane('XY'), 'CQ', 10, 0, false, {
  valign: 'top',
  font: 'Arial',
})
let result = cq.val(r5)
