// source: test_free_functions.py::test_sweep (var r4)
// r4 = sweep((rect(1,1), rect(1,1).moved(z=1)), segment((0,0,0),(0,0,1)),
//            cap=True) — multi-section sweep whose two sections coincide with
// the path endpoints: same 1x1x1 box as r3 (ref: 6 PLANE, vol 1.0).
// Reproduced with a ruled loft between the two sections.
// ref (cadquery 2.8.0): Solid, vol 1.0, 6 PLANE faces
import * as cq from '@faicad/cq-compat'
let w0 = cq.rect(cq.Workplane('XY'), 1, 1)
let w1 = await cq.workplane(w0, { offset: 1 })
let w2 = cq.rect(w1, 1, 1)
let r4 = await cq.loft(w2, { ruled: true })
let result = cq.val(r4)
