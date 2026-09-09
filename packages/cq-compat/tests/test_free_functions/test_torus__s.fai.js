// source: test_free_functions.py::test_torus (var s)
// s = torus(10, 2)   (free function: d1/d2 = DIAMETERS, centred at origin)
// ref (cadquery 2.8.0): Solid, vol 2*pi^2*5 (R=5, r=1)
import * as cq from '@faicad/cq-compat'
let s = await cq.torus(cq.Workplane(), 10, 2)
let result = cq.val(s)
