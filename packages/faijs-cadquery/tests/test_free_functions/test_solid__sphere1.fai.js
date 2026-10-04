// source: test_free_functions.py::test_solid (var sphere1)
// sphere1 = sphere(0.1).moved(b_large) — d=0.1 (r=0.05), moved to (0,0,0.5)
// ref: vol 0.000524, f1/e3/v2/s1
import * as cq from '@faicad/faijs-cadquery'
let sph = await cq.sphere(cq.Workplane(), 0.05, { centered: [true, true, true] })
let sph_m = await cq.translate(sph, [0, 0, 0.5])
let result = cq.val(sph_m)