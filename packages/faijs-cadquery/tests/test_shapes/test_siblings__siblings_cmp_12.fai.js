// source: test_shapes.py::test_siblings (var siblings_cmp_12)
// siblings_cmp_12 = faces(">Z").siblings(box, "Edge", (1,2)) → 5 faces (4 sides + bottom).
import * as cq from '@faicad/faijs-cadquery'
let simple_box = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let g = cq.faces(simple_box, '>Z')
let siblings_cmp_12 = await cq.siblings(g, simple_box, 'Edge', [1, 2])
let result = cq.val(siblings_cmp_12)
