// source: test_shapes.py::test_addCavity (var b2)
// b2 = box(1, 1, 1).moved(z=0.5)
// ref: vol 1, f6/e12/v8/s1, bb x[-0.5,0.5] y[-0.5,0.5] z[0.5,1.5]
import * as cq from '@faicad/faijs-cadquery'
let b = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let b2 = await cq.translate(b, [0, 0, 0.5])
let result = cq.val(b2)
