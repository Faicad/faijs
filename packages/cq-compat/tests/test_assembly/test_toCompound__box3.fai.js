// source: test_assembly.py::test_toCompound (var box3)
// box3 = cq.Workplane().box(1, 1, 6) — bare Solid var, centered.
// ref (cadquery 2.8.0 probe): vol 6, bbox x[-0.5,0.5] y[-0.5,0.5] z[-3,3]
import * as cq from '@faicad/cq-compat'
let box3 = await cq.box(cq.Workplane('XY'), 1, 1, 6)
let result = cq.val(box3)
