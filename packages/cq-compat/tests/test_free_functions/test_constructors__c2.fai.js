// source: test_free_functions.py::test_constructors (var c2)
// c2 = compound(*b.Faces()) — same 6-face compound of box(1,1,1).
import * as cq from '@faicad/cq-compat'
let w0 = cq.Workplane('XY')
let b = await cq.box(w0, 1, 1, 1, { centered: [true, true, false] })
let c2 = await cq.faceCompound(b, 'all')
let result = cq.val(c2)
