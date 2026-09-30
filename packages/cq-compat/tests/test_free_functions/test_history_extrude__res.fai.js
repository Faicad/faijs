// source: test_free_functions.py::test_history_extrude (var res)
// f = plane(1, 1)  -> 1x1 square face in XY at z=0
// res = extrude(f, (0, 0, 1))  -> 1x1x1 box, base on z=0, x/y centred
// (The History/subshape introspection in the upstream test is NOT mirrored;
//  only the resulting solid `res` is parity-checked.)
// ref (cadquery 2.8.0): Solid, vol 1, 6 faces.
import * as cq from '@faicad/cq-compat'
let res = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(res)
