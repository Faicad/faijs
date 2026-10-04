// source: test_free_functions.py::test_solid (var b)
// b = box(1, 1, 1) — xy-centred, base z=0
// ref: vol 1, f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let b = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(b)