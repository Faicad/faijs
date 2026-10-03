// source: test_assembly.py::test_toCompound (var c3)
// c3 = assy0.toCompound() AFTER assy0.solve(): all three Plane mates resolved,
// boxes stacked bottom-to-top → highest face at z=18 (BoundingBox().zlen == 18).
//   box0 bottom-anchored z[0,3]
//   box1 mated onto box0 top (z=3) → center z=5,  bbox z[3,7]
//   box2 mated onto box1 top (z=7) → center z=9.5, bbox z[7,12]
//   box3 mated onto box2 top (z=12) → center z=15, bbox z[12,18]
// ref (cadquery 2.8.0 probe, 4 solids, vol 18, zlen 18):
//   x/y all [-0.5,0.5]; z bands [0,3] [3,7] [7,12] [12,18]
// Solved through the CadQuery grammar (cq-compat-assembly solve()/toCompound()).
import * as cq from '@faicad/faijs-cadquery'
import * as cqa from '@faicad/faijs-cadquery/assembly'
let box0 = await cq.box(cq.Workplane('XY'), 1, 1, 3, { centered: [true, true, false] })
let box1 = await cq.box(cq.Workplane('XY'), 1, 1, 4)
let box2 = await cq.box(cq.Workplane('XY'), 1, 1, 5)
let box3 = await cq.box(cq.Workplane('XY'), 1, 1, 6)
let cA = await cqa.constraint('box0', '>Z', box0, 'box1', '<Z', box1, 'Plane')
let cB = await cqa.constraint('box1', '>Z', box1, 'box2', '<Z', box2, 'Plane')
let cC = await cqa.constraint('box2', '>Z', box2, 'box3', '<Z', box3, 'Plane')
let asm = cqa.buildAssembly('assy0', [
  { name: 'box0', shape: box0 },
  { name: 'box1', shape: box1 },
  { name: 'box2', shape: box2 },
  { name: 'box3', shape: box3 },
], [cA, cB, cC])
asm.solve()
let result = asm.toCompound()
