// source: test_free_functions.py::test_solid (var s6)
// s6 = solid(b_large.Faces(), inner=b_small.Faces()+b_small.moved(x=1).Faces())
// Outer 10x10x1 box with 2 small box voids (0.1^3) at (0,0,0.5) and (1,0,0.5).
// ref: vol 99.998, f18/e36/v24/s1
import * as cq from '@faicad/faijs-cadquery'
let b_large = await cq.box(cq.Workplane(), 10, 10, 1, { centered: [true, true, false] })
let b_small = await cq.box(cq.Workplane(), 0.1, 0.1, 0.1, { centered: [true, true, false] })
let bs1 = await cq.translate(b_small, [0, 0, 0.5])
let bs2 = await cq.translate(b_small, [1, 0, 0.5])
let bLargeFaces = cq.faces(b_large, '')
let bs1Faces = cq.faces(bs1, '')
let bs2Faces = cq.faces(bs2, '')
let result = cq.solidWithInner(bLargeFaces, [bs1Faces, bs2Faces])