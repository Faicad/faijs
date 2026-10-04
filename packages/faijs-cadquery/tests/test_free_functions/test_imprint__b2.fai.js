// source: test_free_functions.py::test_imprint (var b2)
// b2 = b1.moved(x=1) — unit box shifted +1 in x
// ref (cadquery 2.8.0): Solid, vol 1, f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let b1 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let b2 = await cq.translate(b1, [1, 0, 0])
let result = cq.val(b2)