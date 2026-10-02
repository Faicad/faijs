// source: test_assembly.py::test_toCompound (var box2)
// box2 = cq.Workplane().box(1, 1, 5) — bare Solid var, centered.
// ref (cadquery 2.8.0 probe): vol 5, bbox x[-0.5,0.5] y[-0.5,0.5] z[-2.5,2.5]
import * as cq from '@faicad/faijs-cadquery'
let box2 = await cq.box(cq.Workplane('XY'), 1, 1, 5)
let result = cq.val(box2)
