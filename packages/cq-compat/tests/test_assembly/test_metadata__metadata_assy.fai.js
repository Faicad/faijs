// source: test_assembly.py::test_metadata (var metadata_assy)
// metadata_assy = Assembly(b1@loc(2,-5,0)) + sub(b2@loc(1,1,1)) +
// sub2(sub2-0 b1@loc(1,0,0), sub2-1 b1@loc(2,0,0)). Metadata/name bookkeeping
// is not STEP-observable; the harness exports the assembly compound.
// ref (cadquery 2.8.0 probe, 4 axis-aligned solids):
//   b1    1x1x1 bbox x[2,3]    y[-5,-4]   z[0,1]
//   b2    1x1x2 bbox x[2.5,3.5] y[-4.5,-3.5] z[0,2]  (centered box @ (3,-4,1))
//   sub2-0 1x1x1 bbox x[3,4]    y[-5,-4]   z[0,1]
//   sub2-1 1x1x1 bbox x[4,5]    y[-5,-4]   z[0,1]
import * as cq from '@faicad/cq-compat'
let bA = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: false })
let bAt = await cq.translate(bA, [2, -5, 0])
let bB = await cq.box(cq.Workplane('XY'), 1, 1, 2)
let bBt = await cq.translate(bB, [3, -4, 1])
let bC = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: false })
let bCt = await cq.translate(bC, [3, -5, 0])
let bD = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: false })
let bDt = await cq.translate(bD, [4, -5, 0])
let metadata_assy = cq.compound(cq.val(bAt), cq.val(bBt), cq.val(bCt), cq.val(bDt))
let result = metadata_assy
