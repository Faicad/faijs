// source: test_free_functions.py::test_draft (var box_shape)
// box_shape = box(1, 1, 1)  (module-level free function, z in [0, 1]) — the
// draft() assertions in the case are not STEP-observable; the harness exports
// the fixture itself.
// ref (cadquery 2.8.0 probe): Solid, vol 1, bbox x/y [-0.5,0.5], z [0,1]
import * as cq from '@faicad/cq-compat'
let box_shape = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(box_shape)
