// source: test_shapes.py::test_siblings (var level_123)
// level_123 = face("<X").siblings(stacked_box, "Vertex", (1,2,3)) — union of levels 1/2/3 (disjoint).
import * as cq from '@faicad/faijs-cadquery'
let simple_box = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let b1 = cq.moved(simple_box, cq.Location([1, 0, 0]))
let b2 = cq.moved(simple_box, cq.Location([2, 0, 0]))
let b3 = cq.moved(simple_box, cq.Location([3, 0, 0]))
let s1 = await cq.union(simple_box, b1)
let s2 = await cq.union(s1, b2)
let stacked_box = await cq.union(s2, b3)
let f = cq.faces(stacked_box, '<X')
let level_123 = await cq.siblings(f, stacked_box, 'Vertex', [1, 2, 3])
let result = cq.val(level_123)
