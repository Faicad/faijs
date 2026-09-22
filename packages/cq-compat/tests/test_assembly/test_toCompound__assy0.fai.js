// source: test_assembly.py::test_toCompound (var assy0)
// assy0.toCompound() — NOT solved. Top-level assy0 = box0 (bottom-anchored,
// z[0,3]) + box1 (centered, z[-2,2]); the Plane constraint to box1 was added
// but solve() has not been called yet.
// ref (cadquery 2.8.0 probe, 2 solids):
//   vol 3 bbox x[-0.5,0.5] y[-0.5,0.5] z[0,3]
//   vol 4 bbox x[-0.5,0.5] y[-0.5,0.5] z[-2,2]
import * as cq from '@faicad/cq-compat'
let box0 = await cq.box(cq.Workplane('XY'), 1, 1, 3, { centered: [true, true, false] })
let box1 = await cq.box(cq.Workplane('XY'), 1, 1, 4)
let assy0 = cq.compound(cq.val(box0), cq.val(box1))
let result = assy0
