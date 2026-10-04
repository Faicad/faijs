// source: test_free_functions.py::test_offset (var r3)
// f = plane(1, 1);  r3 = offset(f, 1, both=True)
// `both=True` is the FUSE of the +t and -t offsets (shapes.py:7009-7023), so the
// 1x1 face grows 1 in BOTH normal directions -> a 1x1x2 solid.
// ref (cadquery 2.8.0): Solid vol 2 | 10 faces, 20 edges, 12 verts | bb (-0.5..0.5)^2 z[-1,1]
import * as cq from '@faicad/faijs-cadquery'
let f = await cq.plane(1, 1)
let r3 = await cq.offset(f, 1, { both: true })
let result = cq.val(r3)
