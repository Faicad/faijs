// source: test_free_functions.py::test_solid (var s5)
// s5 = solid(b_large.Faces(), inner=sphere1.Faces()+sphere2.Faces())
// Outer 10x10x1 box with 2 spherical voids (d=0.1, r=0.05).
// ref: vol 99.99895, f8/e18/v12/s1
import * as cq from '@faicad/faijs-cadquery'
let b_large = await cq.box(cq.Workplane(), 10, 10, 1, { centered: [true, true, false] })
let sph = await cq.sphere(cq.Workplane(), 0.05, { centered: [true, true, true] })
let sph1 = await cq.translate(sph, [0, 0, 0.5])
let sph2 = await cq.translate(sph, [2, 0, 0.5])
let bLargeFaces = cq.faces(b_large, '')
let sph1Faces = cq.faces(sph1, '')
let sph2Faces = cq.faces(sph2, '')
let result = cq.solidWithInner(bLargeFaces, [sph1Faces, sph2Faces])