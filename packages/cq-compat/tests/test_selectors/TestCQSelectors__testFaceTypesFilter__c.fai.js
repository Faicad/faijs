// source: test_selectors.py::TestCQSelectors::testFaceTypesFilter (var c)
// c = CQ(makeUnitCube()) — face type filter assertions in-process; exports unit cube.
import * as cq from '@faicad/cq-compat'
let c = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(c)
