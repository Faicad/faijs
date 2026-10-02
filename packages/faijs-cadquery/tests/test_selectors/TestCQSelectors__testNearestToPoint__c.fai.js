// source: test_selectors.py::TestCQSelectors::testNearestToPoint (var c)
// c = CQ(makeUnitCube()) — NearestToPointSelector picks in-process; exports unit cube.
import * as cq from '@faicad/faijs-cadquery'
let c = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: false })
let result = cq.val(c)
