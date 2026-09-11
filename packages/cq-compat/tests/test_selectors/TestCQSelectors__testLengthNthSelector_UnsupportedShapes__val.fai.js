// source: test_selectors.py::TestCQSelectors::testLengthNthSelector_UnsupportedShapes (var val)
// The loop body rebinds val to w0.faces().val() / shells().val() /
// compounds().val() — each raises ValueError before rebinding, so the harness
// snapshots the last successful assignment: w0 itself (the rarray box pair).
// ref probe: two fused boxes, vol 2, x [-1.5,1.5], 12 faces.
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let t1 = await cq.translate(b1, [-1, 0, 0])
let b2 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let t2 = await cq.translate(b2, [1, 0, 0])
let w0 = await cq.union(t1, t2)
let result = cq.val(w0)
