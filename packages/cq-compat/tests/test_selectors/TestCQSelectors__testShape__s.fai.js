// source: test_selectors.py::TestCQSelectors::testShape (var s)
// s = w.val() where w = Workplane().box(3, 2, 1)
// ref (cadquery 2.8.0): Solid, vol 6
import * as cq from '@faicad/cq-compat'
let w = await cq.box(cq.Workplane('XY'), 3, 2, 1)
let s = cq.val(w)
let result = s
