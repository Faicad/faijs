// source: test_free_functions.py::test_solid (var s2)
// s2 = solid(*b.Faces())  — same sew, same solid
// ref anchor: vol=1, bbox ±0.5 × z[0,1], topo f6/e12/v8/s1
import * as cq from '@faicad/cq-compat'
let s2 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(s2)
