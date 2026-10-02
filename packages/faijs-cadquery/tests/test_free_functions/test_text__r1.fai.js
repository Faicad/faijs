// source: test_free_functions.py::test_text (var r1)
// r1 = text("CQ", 10)
//
// `cadquery.func.text` builds FLAT glyph faces (no prism) — `distance`/`combine`
// are Workplane-only concepts, so the transliteration is Workplane.text with
// distance = 0 and combine = false.
//
// `font` is spelled out even though upstream omits it: upstream's default is
// font="Arial", resolved through OCC's system font manager, while cq-compat
// falls back to the engine's bundled face when no font is named. Naming it is
// what makes the two agree.
import * as cq from '@faicad/faijs-cadquery'
let r1 = await cq.text(cq.Workplane('XY'), 'CQ', 10, 0, false, { font: 'Arial' })
let result = cq.val(r1)
