// source: test_selectors.py::TestCQSelectors::testAll (var c)
// c = CQ(makeUnitCube()) — face/edge count assertions are not STEP-observable; exports unit cube (vol 1, z 0..1).
import * as cq from '@faicad/cq-compat'
let c = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(c)
