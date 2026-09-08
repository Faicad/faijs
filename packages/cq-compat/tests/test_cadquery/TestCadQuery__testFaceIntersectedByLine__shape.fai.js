// source: test_cadquery.py::TestCadQuery::testFaceIntersectedByLine (var shape)
// shape = Workplane().box(20,10,5).faces(">Z").workplane()
//           .pushPoints([(-10,0),(-5,0),(0,0),(5,0),(10,0)]).box(1,10,10)
// default combine=True -> the five 1x10x10 blocks are fused with the base plate
import * as cq from '@faicad/cq-compat'
let base = await cq.box(cq.Workplane('XY'), 20, 10, 5)
let top = await cq.faces(base, '>Z')
let wp1 = await cq.workplane(top)
let wp2 = cq.pushPoints(wp1, [[-10, 0], [-5, 0], [0, 0], [5, 0], [10, 0]])
let shape = await cq.box(wp2, 1, 10, 10)
let result = cq.val(shape)
