// source: test_free_functions.py::test_loft_vertex (var r3)
// r3 = loft(vertex(0, 0, -1), plane(1, 1), vertex(0, 0, 1))
// Vertex - face - vertex loft. Upstream uses smooth (non-ruled) interpolation,
// so the 4 side faces are BSPLINE surfaces and the volume (1.066667) is larger
// than the ruled double pyramid (0.666667).
// ref (cadquery 2.8.0): Solid, vol 1.066667, 4 faces (all BSPLINE)
import * as cq from '@faicad/cq-compat'
let w0 = await cq.rect(cq.Workplane('XY'), 1, 1)
let r3 = await cq.loft(w0, { startPoint: [0, 0, -1], endPoint: [0, 0, 1] })
let result = cq.val(r3)
