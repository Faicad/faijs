// source: test_free_functions.py::test_constructors (var c1)
// c1 = compound(b.Faces()) — the 6 faces of box(1,1,1) as a compound.
import * as cq from '@faicad/faijs-cadquery'
let w0 = cq.Workplane('XY')
let b = await cq.box(w0, 1, 1, 1, { centered: [true, true, false] })
let c1 = await cq.faceCompound(b, 'all')
let result = cq.val(c1)
