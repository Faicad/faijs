// source: test_free_functions.py::test_history_bool (var b1)
// b1 = box(1, 1, 1)   (module-level free function, z in [0, 1])
// ref (cadquery 2.8.0): Solid, vol 1
import * as cq from '@faicad/cq-compat'
let b0 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let b1 = await cq.translate(b0, [0, 0, 0.5])
let result = cq.val(b1)
