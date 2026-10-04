// source: test_free_functions.py::test_solid (var s1)
// s1 = solid(b.Faces()) — solid from box faces, no voids
// ref: vol 1, f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let b = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let bFaces = cq.faces(b, '')
let result = cq.solid(bFaces)