// source: test_free_functions.py::test_constructors (var c2)
// c2 = compound(*b.Faces())  — identical geometry to c1 (spread vs list form)
// ref (cadquery 2.8.0): Compound, vol/area 6
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let c2 = await cq.faceCompound(b, 'all')
let result = cq.val(c2)
