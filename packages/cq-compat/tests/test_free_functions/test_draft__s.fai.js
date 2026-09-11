// source: test_free_functions.py::test_draft (var s)
// s = extrude(face(ellipse(2, 1)), (0, 0, 1)) — the draft() ValueError paths
// in the case are not STEP-observable; the harness exports s itself.
// ref (cadquery 2.8.0 probe): Solid, vol 6.283185 (= pi*2*1*1), bbox
// x [-2,2] y [-1,1] z [0,1], 3 faces.
import * as cq from '@faicad/cq-compat'
let e = await cq.ellipse(cq.Workplane('XY'), 2, 1)
let s = await cq.extrude(e, 1)
let result = cq.val(s)
