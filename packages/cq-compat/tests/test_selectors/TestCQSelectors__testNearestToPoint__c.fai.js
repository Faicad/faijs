// source: test_selectors.py::TestCQSelectors::testNearestToPoint (var c)
// c = CQ(makeUnitCube()) — NearestToPointSelector picks in-process; exports unit cube.
import * as cq from '@faicad/cq-compat'
let c = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(c)
