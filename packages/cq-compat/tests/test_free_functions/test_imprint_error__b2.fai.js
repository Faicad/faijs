// source: test_free_functions.py::test_imprint_error (var b2)
// b2 = b1.moved(x=1) — Shape.moved with keyword translation (b1 shifted +1 in x)
// ref (cadquery 2.8.0 probe): Solid, vol 1, bbox x [0.5,1.5], z [0,1]
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let b2 = await cq.moved(b1, cq.Location([1, 0, 0]))
let result = cq.val(b2)
