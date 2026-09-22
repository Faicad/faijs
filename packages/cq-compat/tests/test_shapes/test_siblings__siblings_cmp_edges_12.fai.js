// source: test_shapes.py::test_siblings (var siblings_cmp_edges_12)
// siblings_cmp_edges_12 = edges(">Z").siblings(box, "Vertex", (1,2)) → 8 edges (4 top + 4 side).
import * as cq from '@faicad/cq-compat'
let simple_box = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let e = cq.edges(simple_box, '>Z')
let siblings_cmp_edges_12 = await cq.siblings(e, simple_box, 'Vertex', [1, 2])
let result = cq.val(siblings_cmp_edges_12)
