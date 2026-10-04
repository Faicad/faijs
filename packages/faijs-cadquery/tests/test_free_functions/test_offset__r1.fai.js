// source: test_free_functions.py::test_offset (var r1)
// f = plane(1, 1);  r1 = offset(f, 1)
// Free-function `offset` on a 1x1 planar face: thickens it by +1 along its
// normal (+Z) into a 1x1x1 solid.
// ref (cadquery 2.8.0): Solid vol 1 | 6 faces, 12 edges, 8 verts | bb (-0.5..0.5)^2 z[0,1]
import * as cq from '@faicad/faijs-cadquery'
let f = await cq.plane(1, 1)
let r1 = await cq.offset(f, 1)
let result = cq.val(r1)
