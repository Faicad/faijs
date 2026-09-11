// source: test_assembly.py::test_fixed_rotation (var assy)
// Same case re-exported after the assy2 nesting round-trip — identical
// geometry to simple_assy2 (ref probe identical).
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let b20 = await cq.box(cq.Workplane('XY'), 2, 1, 1)
let b2r = await cq.rotate(b20, [1, 0, 0], 45)
let b2 = await cq.translate(b2r, [0, 0, -3])
let assy = cq.compound(cq.val(b1), cq.val(b2))
let result = assy
