// source: test_cadquery.py::TestCadQuery::test_getitem (var w)
// w = Workplane().rarray(2,0,5,1).box(1,1,1,combine=False): upstream val() =
// objects[0] = FIRST box (x=-4). Ref STEP holds one box.
// The full 5-box compound is covered by src/p4-ops.test.ts.
import * as cq from '@faicad/cq-compat'
let wp0 = cq.pushPoints(cq.Workplane(), [[-4, 0]])
let w = await cq.box(wp0, 1, 1, 1, { combine: false })
let result = cq.val(w)
