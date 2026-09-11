// source: test_selectors.py::TestCQSelectors::testLengthNthSelector_UnsupportedShapes (var w0)
// w0 = Workplane().rarray(2, 2, 2, 1).box(1, 1, 1) — 2x1 array of boxes spaced
// 2 apart (rarray xSpacing/ySpacing, xCount/yCount). The LengthNthSelector
// assertions (ValueError on face/shell/solid/compound) are not
// STEP-observable; the harness exports the final shape (probe: two boxes
// fused compound, vol 2, x [-1.5,1.5], 12 faces).
// rarray(2,2,2,1): xSpacing=2 ySpacing=2 xCount=2 yCount=1 -> centers (-1,0),(1,0)
// boxes are fully centered (upstream default centered=True, z [-0.5,0.5])
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let t1 = await cq.translate(b1, [-1, 0, 0])
let b2 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let t2 = await cq.translate(b2, [1, 0, 0])
let w0 = await cq.union(t1, t2)
let result = cq.val(w0)
