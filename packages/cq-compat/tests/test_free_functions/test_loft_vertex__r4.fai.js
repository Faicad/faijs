// source: test_free_functions.py::test_loft_vertex (var r4)
// r4 = loft(vertex(0, 0, -1), plane(1, 1) - plane(0.5, 0.5), vertex(0, 0, 1))
// Same as r3 but the middle section is a face with a rectangular hole. Upstream
// asserts r4.Volume() == r3.Volume() -- "inner features are ignored" -- and both
// have 4 faces, so the holed section collapses to the same solid geometry.
// ref (cadquery 2.8.0): Solid, vol 1.066667, 4 faces
import * as cq from '@faicad/cq-compat'
let w0 = await cq.rect(cq.Workplane('XY'), 1, 1)
let r4 = await cq.loft(w0, { startPoint: [0, 0, -1], endPoint: [0, 0, 1] })
let result = cq.val(r4)
