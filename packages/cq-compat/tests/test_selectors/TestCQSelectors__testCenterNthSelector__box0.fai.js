// source: test_selectors.py::TestCQSelectors::testCenterNthSelector (var box0)
// box0 = Workplane().box(1,1,1,centered=(True,True,True)) — fully centred cube.
import * as cq from '@faicad/cq-compat'
let box0 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: true })
let result = cq.val(box0)
