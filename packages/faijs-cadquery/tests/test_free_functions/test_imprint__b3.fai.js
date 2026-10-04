// source: test_free_functions.py::test_imprint (var b3)
// b3 = box(0.5, 0.5, 0.5).moved(x=0.75) — half-size box shifted +0.75 in x
// ref (cadquery 2.8.0): Solid, vol 0.125, f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let b3 = await cq.box(cq.Workplane(), 0.5, 0.5, 0.5, { centered: [true, true, false] })
let b3m = await cq.translate(b3, [0.75, 0, 0])
let result = cq.val(b3m)