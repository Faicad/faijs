// source: test_free_functions.py::test_solid (var s1)
// s1 = solid(b.Faces())  — sews the box's own faces back into the same solid
// (the sew/solid assert is non-geometry; the ref solid IS the unit box)
// ref anchor: vol=1, bbox ±0.5 × z[0,1], topo f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let s1 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(s1)
