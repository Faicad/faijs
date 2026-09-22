// source: test_selectors.py::TestCQSelectors::testCenterNthSelector (var box0_selected)
// box0_selected = part.solids(CenterNthSelector(dir,0)) — geometry equals box0; solid pick not STEP-observable.
import * as cq from '@faicad/cq-compat'
let box0 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: true })
let result = cq.val(box0)
