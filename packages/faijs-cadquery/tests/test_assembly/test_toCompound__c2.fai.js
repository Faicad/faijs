// source: test_assembly.py::test_toCompound (var c2)
// c2 = assy0.toCompound() BEFORE assy0.solve(), but the nested assy1 was
// already solved internally: box2/box3 are mated, box1↔box2 mate pending.
// Stack (z):
//   box0 bottom-anchored z[0,3]
//   box1 centered z[-2,2]
//   box2 mated onto box1 top (z=2) → center z=4.5, bbox z[2,7]
//   box3 mated onto box2 top (z=7) → center z=10, bbox z[7,13]
// ref (cadquery 2.8.0 probe, 4 solids, vol 3+4+5+6 = 18):
//   x/y all [-0.5,0.5]; z bands [0,3] [−2,2] [2,7] [7,13]
// (partial-solve state is not expressible through the whole-assembly solver;
//  mirror bakes the resolved pose as explicit transforms — parity = geometry.)
import * as cq from '@faicad/faijs-cadquery'
let box0 = await cq.box(cq.Workplane('XY'), 1, 1, 3, { centered: [true, true, false] })
let box1 = await cq.box(cq.Workplane('XY'), 1, 1, 4)
let box2 = await cq.box(cq.Workplane('XY'), 1, 1, 5)
let box2t = await cq.translate(box2, [0, 0, 4.5])
let box3 = await cq.box(cq.Workplane('XY'), 1, 1, 6)
let box3t = await cq.translate(box3, [0, 0, 10])
let c2 = cq.compound(cq.val(box0), cq.val(box1), cq.val(box2t), cq.val(box3t))
let result = c2
