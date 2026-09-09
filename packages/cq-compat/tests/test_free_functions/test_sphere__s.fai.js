// source: test_free_functions.py::test_sphere (var s)
// s = sphere(2)   (free function: d=DIAMETER, centred at origin)
// ref (cadquery 2.8.0): Solid, vol 4/3*pi (r=1)
import * as cq from '@faicad/cq-compat'
let s = await cq.sphere(cq.Workplane(), 1)
let result = cq.val(s)
