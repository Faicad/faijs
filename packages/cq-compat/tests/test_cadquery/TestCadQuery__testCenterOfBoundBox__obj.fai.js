// source: test_cadquery.py::TestCadQuery::testCenterOfBoundBox (var obj)
// obj = Workplane().pushPoints([(0, 0), (2, 2)]).box(1, 1, 1)
// default combine=True -> the two cubes are fused into one solid
import * as cq from '@faicad/cq-compat'
let wp0 = cq.pushPoints(cq.Workplane('XY'), [[0, 0], [2, 2]])
let obj = await cq.box(wp0, 1, 1, 1)
let result = cq.val(obj)
