// source: test_free_functions.py::test_loft_vertex (var r2)
// r2 = loft(plane(1, 1), vertex(0, 0, 1))
// Face-to-vertex loft: ruled pyramid over the 1x1 base, apex at (0,0,1).
// ref (cadquery 2.8.0): Solid, vol 0.333333, 5 faces (all PLANE)
import * as cq from '@faicad/cq-compat'
let w0 = await cq.rect(cq.Workplane('XY'), 1, 1)
let r2 = await cq.loft(w0, { endPoint: [0, 0, 1] })
let result = cq.val(r2)
