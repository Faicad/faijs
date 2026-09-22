// source: test_assembly.py::test_toCompound (var c1)
// c1 = nested_assy.toCompound() — the unsolved nested assembly compound
// (4 solids). Same geometry as test_toCompound__nested_assy.
// ref (cadquery 2.8.0 probe, 4 axis-aligned solids):
//   1x1x1   bbox x[-0.5,0.5]  y[-0.5,0.5]  z[-0.5,0.5]
//   1x1x1   bbox x[3.5,4.5]   y[3.5,4.5]   z[-0.5,0.5]
//   1x1x0.5 bbox x[-2.5,-1.5] y[3.5,4.5]   z[-0.25,0.25]
//   1x1x0.5 bbox x[1.5,2.5]   y[3.5,4.5]   z[-0.25,0.25]
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let b2 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let b2t = await cq.translate(b2, [0, 4, 0])
let b3a = await cq.box(cq.Workplane('XY'), 1, 1, 0.5)
let b3at = await cq.translate(b3a, [-2, 4, 0])
let b3b = await cq.box(cq.Workplane('XY'), 1, 1, 0.5)
let b3bt = await cq.translate(b3b, [2, 4, 0])
let c1 = cq.compound(cq.val(b1), cq.val(b2t), cq.val(b3at), cq.val(b3bt))
let result = c1
