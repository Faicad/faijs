// source: test_shapes.py::test_siblings (var stacked_box)
// stacked_box = fuse(box, box.moved(x=1), box.moved(x=2), box.moved(x=3)) → single 4×1×1 solid (vol 4).
import * as cq from '@faicad/cq-compat'
let simple_box = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let b1 = cq.moved(simple_box, cq.Location([1, 0, 0]))
let b2 = cq.moved(simple_box, cq.Location([2, 0, 0]))
let b3 = cq.moved(simple_box, cq.Location([3, 0, 0]))
let s1 = await cq.union(simple_box, b1)
let s2 = await cq.union(s1, b2)
let stacked_box = await cq.union(s2, b3)
let result = cq.val(stacked_box)
