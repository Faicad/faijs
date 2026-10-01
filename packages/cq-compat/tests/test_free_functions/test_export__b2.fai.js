// source: test_free_functions.py::test_export (var b2)
// b2 = Shape.importBrep("box.brep")  (round-trips b1; ref is the same box)
// ref anchor: vol=1, bbox ±0.5 × z[0,1], topo f6/e12/v8/s1
import * as cq from '@faicad/cq-compat'
let b2 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(b2)
