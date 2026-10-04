// source: test_free_functions.py::test_offset (var r2)
// s = box(1, 1, 1).shells();  r2 = offset(s, -0.25)
// Free-function `offset` on the SHELL of a unit box with a NEGATIVE distance:
// the kernel thickens the shell inward -> a hollow box (6 outer + 6 inner faces).
// NOTE the free-function box sits ON the XY plane (centered x,y; z from 0 to h,
// `shapes.py:6409` BRepPrimAPI_MakeBox at (-w/2,-l/2,0)) -> centered [true,true,false].
// ref (cadquery 2.8.0): Solid vol 0.875 | 12 faces, 24 edges, 16 verts | bb (-0.5..0.5)^2 z[0,1]
import * as cq from '@faicad/faijs-cadquery'
let b = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let s = cq.shells(b)
let r2 = await cq.offset(s, -0.25)
let result = cq.val(r2)
