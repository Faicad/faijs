// source: test_assembly.py::test_point_constraint (var assy)
// Same case, re-exported after the assy2 nesting round-trip — identical
// geometry to simple_assy2 (ref probe identical: vol 3, com z 0.6667).
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let b20 = await cq.box(cq.Workplane('XY'), 2, 1, 1)
let b2 = await cq.translate(b20, [0, 0, 1])
let assy = cq.compound(cq.val(b1), cq.val(b2))
let result = assy
