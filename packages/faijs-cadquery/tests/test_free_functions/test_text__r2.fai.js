// source: test_free_functions.py::test_text (var r2)
// r2 = text("CQ", 10, halign="left")
// Flat glyph faces (distance = 0); see test_text__r1.fai.js for the font note.
import * as cq from '@faicad/faijs-cadquery'
let r2 = await cq.text(cq.Workplane('XY'), 'CQ', 10, 0, false, {
  halign: 'left',
  font: 'Arial',
})
let result = cq.val(r2)
