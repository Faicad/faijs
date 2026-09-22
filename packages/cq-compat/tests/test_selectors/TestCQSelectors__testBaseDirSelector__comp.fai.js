// source: test_selectors.py::TestCQSelectors::testBaseDirSelector (var comp)
// comp = Workplane(makeUnitCube()).workplane().move(10,10).box(1,1,1) — separated bodies; union keeps 2 solids (vol 2).
import * as cq from '@faicad/cq-compat'
let base = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let small0 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let small = cq.moved(small0, cq.Location([10, 10, 0]))
let comp = await cq.union(base, small)
let result = cq.val(comp)
