// source: test_free_functions.py::test_clean (var b1)
// b1 = box(1, 1, 1)   (free function: xy-centred, base on z=0)
// The clean() result is never exported — only the two operand boxes are.
// ref (cadquery 2.8.0): Solid, vol 1
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(b1)
