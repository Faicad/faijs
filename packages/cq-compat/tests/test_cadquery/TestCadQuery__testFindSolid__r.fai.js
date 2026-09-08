// source: test_cadquery.py::TestCadQuery::testFindSolid (var r)
// r = Workplane("XY").pushPoints([(-2, 0), (2, 0)]).box(1, 1, 1, combine=False)
// upstream val() = objects[0] = FIRST cube (centred at (-2, 0, 0)); the ref STEP
// holds only that one. Per the multi-body mirror convention (tests/README.md) we
// push only the first point. The full 2-cube compound is covered by unit tests.
import * as cq from '@faicad/cq-compat'
let wp0 = cq.pushPoints(cq.Workplane('XY'), [[-2, 0]])
let r = await cq.box(wp0, 1, 1, 1, { combine: false })
let result = cq.val(r)
