// source: test_free_functions.py::test_history_bool (var b2)
// b2 = box(1, 0.5, 0.1)   (module-level free function, z in [0, 0.1])
// ref (cadquery 2.8.0): Solid, vol 0.05
import * as cq from '@faicad/cq-compat'
let b0 = await cq.box(cq.Workplane('XY'), 1, 0.5, 0.1)
let b2 = await cq.translate(b0, [0, 0, 0.05])
let result = cq.val(b2)
