// source: test_free_functions.py::test_text (var r3)
// r3 = text("CQ", 10, halign="right")
// Flat glyph faces (distance = 0); see test_text__r1.fai.js for the font note.
import * as cq from '@faicad/cq-compat'
let r3 = await cq.text(cq.Workplane('XY'), 'CQ', 10, 0, false, {
  halign: 'right',
  font: 'Arial',
})
let result = cq.val(r3)
