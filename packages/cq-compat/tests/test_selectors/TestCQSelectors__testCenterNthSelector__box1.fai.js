// source: test_selectors.py::TestCQSelectors::testCenterNthSelector (var box1)
// box1 = Workplane("XY", origin=(10,10,10)).box(1,1,1,centered=True) — cube at (10,10,10).
import * as cq from '@faicad/cq-compat'
let box1 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: true })
let box1m = cq.moved(box1, cq.Location([10, 10, 10]))
let result = cq.val(box1m)
