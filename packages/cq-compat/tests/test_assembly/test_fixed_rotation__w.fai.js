// source: test_assembly.py::test_fixed_rotation (var w)
// w = cq.Workplane().add(assy.toCompound()) after solve — the same compound
// as simple_assy2/assy (ref probe identical: vol 3, com (0,0,-2)).
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let b20 = await cq.box(cq.Workplane('XY'), 2, 1, 1)
let b2r = await cq.rotate(b20, [1, 0, 0], 45)
let b2 = await cq.translate(b2r, [0, 0, -3])
let w = cq.compound(cq.val(b1), cq.val(b2))
let result = w
