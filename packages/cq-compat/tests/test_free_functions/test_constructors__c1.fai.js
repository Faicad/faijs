// source: test_free_functions.py::test_constructors (var c1)
// b = box(1, 1, 1)   (free function: xy-centred, base on z=0)
// c1 = compound(b.Faces())  — compound of ALL 6 faces (faceCompound 'all')
// ref (cadquery 2.8.0): Compound, vol/area 6
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let c1 = await cq.faceCompound(b, 'all')
let result = cq.val(c1)
