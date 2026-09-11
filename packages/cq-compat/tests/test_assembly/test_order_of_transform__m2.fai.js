// source: test_assembly.py::test_order_of_transform (var m2)
// Second marker sphere after the nested-solve round-trip — coincides with m1
// at (2, -0.7071, 2) (ref probe identical).
import * as cq from '@faicad/cq-compat'
let m0 = await cq.sphere(cq.Workplane('XY'), 0.2)
let m2 = await cq.translate(m0, [2, -0.7071067811865476, 2])
let result = cq.val(m2)
