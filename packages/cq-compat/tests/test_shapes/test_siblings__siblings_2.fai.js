// source: test_shapes.py::test_siblings (var siblings_2)
// siblings_2 = face("<Z").siblings(box, "Edge", (2,)) → 1 face (top).
import * as cq from '@faicad/cq-compat'
let simple_box = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let f = cq.faces(simple_box, '<Z')
let siblings_2 = await cq.siblings(f, simple_box, 'Edge', [2])
let result = cq.val(siblings_2)
