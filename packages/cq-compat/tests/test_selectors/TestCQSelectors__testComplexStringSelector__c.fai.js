// source: test_selectors.py::TestCQSelectors::testComplexStringSelector (var c)
// c = CQ(makeUnitCube()) — "(>X and >Y) or (<X and <Y)" vertex picks in-process; exports unit cube.
import * as cq from '@faicad/cq-compat'
let c = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(c)
