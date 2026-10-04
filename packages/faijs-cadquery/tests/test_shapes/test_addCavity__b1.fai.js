// source: test_shapes.py::test_addCavity (var b1)
// b1 = box(2, 2, 2) — free-function box is xy-centred with its base on z=0
// ref: vol 8, f6/e12/v8/s1, bb x[-1,1] y[-1,1] z[0,2]
import * as cq from '@faicad/faijs-cadquery'
let b1 = await cq.box(cq.Workplane(), 2, 2, 2, { centered: [true, true, false] })
let result = cq.val(b1)
