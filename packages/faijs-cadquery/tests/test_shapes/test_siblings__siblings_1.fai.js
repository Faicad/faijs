// source: test_shapes.py::test_siblings (var siblings_1)
// siblings_1 = face("<Z").siblings(box, "Edge", 1) → 4 side faces (compound).
import * as cq from '@faicad/faijs-cadquery'
let simple_box = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let f = cq.faces(simple_box, '<Z')
let siblings_1 = await cq.siblings(f, simple_box, 'Edge', 1)
let result = cq.val(siblings_1)
