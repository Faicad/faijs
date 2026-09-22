// source: test_selectors.py::TestCQSelectors::testAreaNthSelector_Solids (var selected_solids)
// selected_solids = workplane_solids.solids(AreaNthSelector(1)) → the two
// 20×20×20 boxes (2nd-largest area, at x=0 and x=30). Ref harness exports
// val() = objects[0] = the 20-box at x=0.
import * as cq from '@faicad/cq-compat'
let w0 = cq.Workplane('XY')
let a2 = await cq.box(w0, 20, 20, 20)
let result = cq.val(a2)
