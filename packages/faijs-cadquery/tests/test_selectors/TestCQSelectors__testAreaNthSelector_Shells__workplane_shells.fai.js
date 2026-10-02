// source: test_selectors.py::TestCQSelectors::testAreaNthSelector_Shells (var workplane_shells)
// workplane_shells = Workplane().rarray(10,1,3,1).eachpoint(...) → centred
// boxes 10/20/30 at x=-10/0/10 (rarray is origin-centred). Ref harness exports
// val() = objects[0] = the first (10×10×10) box at x=-10.
import * as cq from '@faicad/faijs-cadquery'
let w0 = cq.Workplane('XY')
let a1 = await cq.box(w0, 10, 10, 10)
let a1m = await cq.translate(a1, [-10, 0, 0])
let result = cq.val(a1m)
