// source: test_free_functions.py::test_cone (var s)
// s is reassigned; final value = cone(2, 1, 1)
//   (free function: d1/d2 = DIAMETERS, base circle on z=0; frustum R=1, r=0.5, h=1)
// ref (cadquery 2.8.0): Solid, vol 1/3*pi*(1+0.5+0.25) = 1.8326
import * as cq from '@faicad/cq-compat'
let s = await cq.cone(cq.Workplane(), 2, 1, 1)
let result = cq.val(s)
