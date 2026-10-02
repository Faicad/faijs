// source: test_shapes.py::test_siblings (var simple_box)
// simple_box = fixture box(1,1,1) (free function, xy-centred, z 0..1); exported for parity with the ref STEP.
import * as cq from '@faicad/faijs-cadquery'
let simple_box = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(simple_box)
