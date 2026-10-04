// source: test_free_functions.py::test_solid (var b1)
// b1 = box(0.1, 0.1, 0.1) — xy-centred, base z=0
// ref: vol 0.001, f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let b1 = await cq.box(cq.Workplane(), 0.1, 0.1, 0.1, { centered: [true, true, false] })
let result = cq.val(b1)