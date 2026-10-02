// source: test_selectors.py::TestCQSelectors::testInverseSelector (var c)
// c = CQ(makeUnitCube()) — InverseSelector filtering in-process; exports unit cube.
import * as cq from '@faicad/faijs-cadquery'
let c = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(c)
