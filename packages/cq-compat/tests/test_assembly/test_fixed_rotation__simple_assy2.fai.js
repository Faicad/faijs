// source: test_assembly.py::test_fixed_rotation (var simple_assy2)
// b1 (1x1x1 centered) fixed at origin; b2 (2x1x1 centered) FixedPoint
// (0,0,-3) + FixedRotation (45,0,0) = rotate +45 deg about x. The harness
// exports the solved compound (ref probe: vol 3, s1 bbox x ±1 y ±0.7071
// z [-3.707,-2.293]).
// WORKAROUND: cq-compat rotate(axis, angle) is euler-based; single-axis x
// rotation == the solver's FixedRotation (45,0,0).
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let b20 = await cq.box(cq.Workplane('XY'), 2, 1, 1)
let b2r = await cq.rotate(b20, [1, 0, 0], 45)
let b2 = await cq.translate(b2r, [0, 0, -3])
let simple_assy2 = cq.compound(cq.val(b1), cq.val(b2))
let result = simple_assy2
