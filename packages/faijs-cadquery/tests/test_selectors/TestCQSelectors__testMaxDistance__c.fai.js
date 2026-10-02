// source: test_selectors.py::TestCQSelectors::testMaxDistance (var c)
// c = CQ(makeUnitCube()) — >Z face/vertex picks in-process; exports unit cube.
import * as cq from '@faicad/faijs-cadquery'
let c = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(c)
