// source: test_assembly.py::test_toCompound (var assy1)
// assy1 = sub-assembly of box2 (1,1,5) + box3 (1,1,6) with
// "box2@faces@>Z" ↔ "box3@faces@<Z" Plane constraint, SOLVED before export.
// Solution: box3 bottom face lands on box2 top (z=2.5) → box3 center z=5.5,
// bbox z[2.5,8.5]; both centered on x/y.
// ref (cadquery 2.8.0 probe, 2 solids):
//   vol 5 bbox x[-0.5,0.5] y[-0.5,0.5] z[-2.5,2.5]
//   vol 6 bbox x[-0.5,0.5] y[-0.5,0.5] z[2.5,8.5]
// Solved through the CadQuery grammar (cq-compat-assembly solve()/toCompound()).
import * as cq from '@faicad/cq-compat'
import * as cqa from '@faicad/cq-compat-assembly'
let box2 = await cq.box(cq.Workplane('XY'), 1, 1, 5)
let box3 = await cq.box(cq.Workplane('XY'), 1, 1, 6)
let c1 = await cqa.constraint('box2', '>Z', box2, 'box3', '<Z', box3, 'Plane')
let asm = cqa.buildAssembly('assy1', [{ name: 'box2', shape: box2 }, { name: 'box3', shape: box3 }], [c1])
asm.solve()
let assy1 = asm.toCompound()
let result = assy1
