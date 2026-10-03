// source: test_cadquery.py::TestCadQuery::testFindSolid (var s, FINAL value)
// r = Workplane("XY").pushPoints([(-2, 0), (2, 0)]).box(1, 1, 1, combine=False)
// s = r.findSolid()  — upstream returns Compound.makeCompound(every solid on the
// stack), so even the two-cube stack ends as a COMPOUND of 2 solids.
// ref (out/ref/…testFindSolid__s.step): vol 2, bbox x[-2.5,2.5] y[-0.5,0.5]
//   z[-0.5,0.5], topo f12/e24/v16/s2
import * as cq from '@faicad/faijs-cadquery'
let wp0 = cq.pushPoints(cq.Workplane('XY'), [[-2, 0], [2, 0]])
let r = await cq.box(wp0, 1, 1, 1, { combine: false })
let result = await cq.findSolid(r)
