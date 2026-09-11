// source: test_free_functions.py::test_imprint_error (var b1)
// b1 = box(1, 1, 1)  (module-level free function, z in [0, 1])
// ref (cadquery 2.8.0 probe): Solid, vol 1, bbox x/y [-0.5,0.5], z [0,1]
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(b1)
