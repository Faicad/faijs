// source: test_free_functions.py::test_imprint (var b1)
// b1 = box(1, 1, 1) — xy-centred, base z=0
// ref (cadquery 2.8.0): Solid, vol 1, f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let b1 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(b1)