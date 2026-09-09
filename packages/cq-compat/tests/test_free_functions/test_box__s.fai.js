// source: test_free_functions.py::test_box (var s)
// s = box(1, 1, 1)   (occ_impl free function: xy-centred, base on z=0)
// ref (cadquery 2.8.0): Solid, vol 1
import * as cq from '@faicad/cq-compat'
let s = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(s)
