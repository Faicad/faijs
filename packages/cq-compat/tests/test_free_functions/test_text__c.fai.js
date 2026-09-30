// source: test_free_functions.py::test_text (var c)
// c = cylinder(10, 10).moved(rz=180)
//
// The free-function `cylinder(d, h)` takes a DIAMETER (d/2 becomes the radius),
// unlike cq-compat's `cylinder(wp, height, radius)` which mirrors
// `Workplane.cylinder(height, radius)` — so the transliteration is radius 5,
// height 10. Base circle on z=0, axis +Z, then a 180° turn about Z (a no-op for
// a cylinder, but kept for faithfulness).
import * as cq from '@faicad/cq-compat'
let cylinder0 = await cq.cylinder(cq.Workplane('XY'), 10, 5, { centered: [true, true, false] })
let c = await cq.rotate(cylinder0, [0, 0, 1], 180)
let result = cq.val(c)
