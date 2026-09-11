// source: test_assembly.py::test_toJSON (var simple_assy)
// toJSON bookkeeping is not STEP-observable; the harness exports the assembly
// compound. ref (cadquery 2.8.0 probe, 4 axis-aligned solids):
//   1x1x1 bbox x[2,3]    y[-5,-4]    z[0,1]      (makeBox @ (2,-5,0))
//   1x1x2 bbox x[2.5,3.5] y[-4.5,-3.5] z[-1,1]   (centered @ (3,-4,0))
//   1x1x3 bbox x[3.5,4.5] y[-2.5,-1.5] z[-1.5,1.5] (centered @ (4,-2,0))
//   1x1x3 bbox x[1.5,2.5] y[-7.5,-6.5] z[-1.5,1.5] (centered @ (2,-7,0))
import * as cq from '@faicad/cq-compat'
let bA = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: false })
let bAt = await cq.translate(bA, [2, -5, 0])
let bB = await cq.box(cq.Workplane('XY'), 1, 1, 2)
let bBt = await cq.translate(bB, [3, -4, 0])
let bC = await cq.box(cq.Workplane('XY'), 1, 1, 3)
let bCt = await cq.translate(bC, [4, -2, 0])
let bD = await cq.box(cq.Workplane('XY'), 1, 1, 3)
let bDt = await cq.translate(bD, [2, -7, 0])
let simple_assy = cq.compound(cq.val(bAt), cq.val(bBt), cq.val(bCt), cq.val(bDt))
let result = simple_assy
