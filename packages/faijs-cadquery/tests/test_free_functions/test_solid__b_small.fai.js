// source: test_free_functions.py::test_solid (var b_small)
// b_small = box(0.1, 0.1, 0.1).moved(b_large) — moved to b_large center (0,0,0.5)
// ref: vol 0.001, f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let b_small = await cq.box(cq.Workplane(), 0.1, 0.1, 0.1, { centered: [true, true, false] })
let b_small_m = await cq.translate(b_small, [0, 0, 0.5])
let result = cq.val(b_small_m)