// source: test_assembly.py::test_toCompound (var box1)
// box1 = cq.Workplane().box(1, 1, 4) — bare Solid var, centered.
// ref (cadquery 2.8.0 probe): vol 4, bbox x[-0.5,0.5] y[-0.5,0.5] z[-2,2]
import * as cq from '@faicad/faijs-cadquery'
let box1 = await cq.box(cq.Workplane('XY'), 1, 1, 4)
let result = cq.val(box1)
