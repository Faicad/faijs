// source: test_selectors.py::TestCQSelectors::testVertexFilter (var c)
// c = CQ(makeUnitCube(centered=False)) — vertices("<XY") pick in-process; exports centred cube.
import * as cq from '@faicad/faijs-cadquery'
let c = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [false, false, false] })
let result = cq.val(c)
