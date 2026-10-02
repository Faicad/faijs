// source: test_selectors.py::TestCQSelectors::testAreaNthSelector_Solids (var workplane_solids)
// workplane_solids = Workplane().rarray(30,1,3,1).eachpoint(...) → centred
// boxes 10/20/20 at x=-30/0/30 (rarray is origin-centred). Ref harness exports
// val() = objects[0] = the first (10×10×10) box at x=-30.
import * as cq from '@faicad/faijs-cadquery'
let w0 = cq.Workplane('XY')
let a1 = await cq.box(w0, 10, 10, 10)
let a1m = await cq.translate(a1, [-30, 0, 0])
let result = cq.val(a1m)
