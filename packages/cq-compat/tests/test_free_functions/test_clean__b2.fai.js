// source: test_free_functions.py::test_clean (var b2)
// b2 = b1.moved(Location(1, 0, 0))   (b1 = box(1,1,1) base z=0)
// ref (cadquery 2.8.0): Solid, vol 1, bbox x in [1, 2]
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let b2 = await cq.translate(b1, [1, 0, 0])
let result = cq.val(b2)
