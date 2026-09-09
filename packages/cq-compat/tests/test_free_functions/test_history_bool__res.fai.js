// source: test_free_functions.py::test_history_bool (var res)
// res = cut(b1, b2) where b1 = box(1,1,1) z in [0,1], b2 = box(1,0.5,0.1)
// z in [0,0.1] (a shallow pocket removed from the bottom face).
// ref (cadquery 2.8.0): Solid, vol 0.95
import * as cq from '@faicad/cq-compat'
let b0 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let b1 = await cq.translate(b0, [0, 0, 0.5])
let t0 = await cq.box(cq.Workplane('XY'), 1, 0.5, 0.1)
let b2 = await cq.translate(t0, [0, 0, 0.05])
let res = await cq.cut(b1, b2)
let result = cq.val(res)
