// source: test_free_functions.py::test_cylinder (var s)
// s = cylinder(2, 1)   (free function: d=DIAMETER, h; base circle on z=0)
// ref (cadquery 2.8.0): Solid, vol pi (r=1, h=1)
import * as cq from '@faicad/cq-compat'
let s = await cq.cylinder(cq.Workplane(), 1, 1, { centered: [true, true, false] })
let result = cq.val(s)
