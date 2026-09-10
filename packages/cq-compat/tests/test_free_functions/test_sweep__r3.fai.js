// source: test_free_functions.py::test_sweep (var r3)
// r3 = sweep(rect(1,1), segment((0,0,0),(0,0,1)), cap=True) — straight-line
// sweep of a square along Z with caps = a 1x1x1 box (ref: 6 PLANE, vol 1.0).
// Reproduced with a ruled loft between the two end sections: for a linear
// path a capped sweep is geometrically identical to a ruled loft.
// ref (cadquery 2.8.0): Solid, vol 1.0, 6 PLANE faces
import * as cq from '@faicad/cq-compat'
let w0 = cq.rect(cq.Workplane('XY'), 1, 1)
let w1 = await cq.workplane(w0, { offset: 1 })
let w2 = cq.rect(w1, 1, 1)
let r3 = await cq.loft(w2, { ruled: true })
let result = cq.val(r3)
