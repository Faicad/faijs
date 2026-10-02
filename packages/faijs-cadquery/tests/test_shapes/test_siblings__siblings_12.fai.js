// source: test_shapes.py::test_siblings (var siblings_12)
// siblings_12 = face("<Z").siblings(box, "Edge", (1,2)) → 5 faces (4 sides + top).
import * as cq from '@faicad/faijs-cadquery'
let simple_box = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let f = cq.faces(simple_box, '<Z')
let siblings_12 = await cq.siblings(f, simple_box, 'Edge', [1, 2])
let result = cq.val(siblings_12)
