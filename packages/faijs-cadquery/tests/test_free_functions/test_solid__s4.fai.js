// source: test_free_functions.py::test_solid (var s4)
// s4 is reassigned: solid(b.Faces(), b1.moved([...]).Faces(), history=hist)
// Same geometry as s3 (history not modelled, G-C18).
// ref: vol 0.998, f18/e36/v24/s1
import * as cq from '@faicad/faijs-cadquery'
let b = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let b1 = await cq.box(cq.Workplane(), 0.1, 0.1, 0.1, { centered: [true, true, false] })
let b1a = await cq.translate(b1, [0.2, 0, 0.5])
let b1b = await cq.translate(b1, [-0.2, 0, 0.5])
let bFaces = cq.faces(b, '')
let b1aFaces = cq.faces(b1a, '')
let b1bFaces = cq.faces(b1b, '')
let result = cq.solid(bFaces, b1aFaces, b1bFaces)