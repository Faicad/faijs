// source: test_assembly.py::test_order_of_transform (var m1)
// m1/m2 = the two marker spheres after solve; both coincide at the tagged
// corner (2, -0.7071, 2): corner (-0.5,-0.5,0.5) of the part rotated 45 deg
// about z at (0,0,1.5) then translated (2,0,0).
// ref (cadquery 2.8.0 probe): sphere r=0.2 at (2,-0.7071,2), vol 0.033510
import * as cq from '@faicad/cq-compat'
let m0 = await cq.sphere(cq.Workplane('XY'), 0.2)
let m1 = await cq.translate(m0, [2, -0.7071067811865476, 2])
let result = cq.val(m1)
