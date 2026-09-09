// source: test_free_functions.py::test_fuse_multi (var b)
// b = box(1, 1, 1)   (free function: xy-centred, base on z=0)
// ref (cadquery 2.8.0): Solid, vol 1
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(b)
