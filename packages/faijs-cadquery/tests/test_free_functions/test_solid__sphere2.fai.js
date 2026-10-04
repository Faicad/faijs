// source: test_free_functions.py::test_solid (var sphere2)
// sphere2 = sphere1.moved(x=2) — at (2,0,0.5)
// ref: vol 0.000524, f1/e3/v2/s1
import * as cq from '@faicad/faijs-cadquery'
let sph = await cq.sphere(cq.Workplane(), 0.05, { centered: [true, true, true] })
let sph1 = await cq.translate(sph, [0, 0, 0.5])
let sph2 = await cq.translate(sph1, [2, 0, 0])
let result = cq.val(sph2)