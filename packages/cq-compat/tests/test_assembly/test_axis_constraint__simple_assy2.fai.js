// source: test_assembly.py::test_axis_constraint (var simple_assy2)
// b1 (1x1x1 centered) + b2 (2x1x1 centered, loc (0,0,4)); Axis constraints
// align the >Z normals (0 deg) and rotate the >X faces 45 deg -> b2 rotated
// +45 deg about z at z=4 (ref probe: vol 3, bbox x/y ±1.0607 =
// 2cos45+1sin45... i.e. rotated 2x1 footprint, z [-0.5,4.5]).
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let b20 = await cq.box(cq.Workplane('XY'), 2, 1, 1)
let b2r = await cq.rotate(b20, [0, 0, 1], 45)
let b2 = await cq.translate(b2r, [0, 0, 4])
let simple_assy2 = cq.compound(cq.val(b1), cq.val(b2))
let result = simple_assy2
