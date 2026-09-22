// source: test_selectors.py::TestCQSelectors::testParallelEdgeFilter (var c)
// c = CQ(makeUnitCube()) — ParallelDirSelector edge picks in-process; exports unit cube.
import * as cq from '@faicad/cq-compat'
let c = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(c)
