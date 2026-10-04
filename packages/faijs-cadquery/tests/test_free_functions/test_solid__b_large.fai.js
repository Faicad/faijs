// source: test_free_functions.py::test_solid (var b_large)
// b_large = box(10, 10, 1) — xy-centred, base z=0
// ref: vol 100, f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let b_large = await cq.box(cq.Workplane(), 10, 10, 1, { centered: [true, true, false] })
let result = cq.val(b_large)