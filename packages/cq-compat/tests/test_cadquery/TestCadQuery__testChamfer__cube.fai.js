// source: test_cadquery.py::TestCadQuery::testChamfer (var cube)
// cube = CQ(makeUnitCube()).faces(">Z").chamfer(0.1); makeUnitCube stub: rect(1,1).extrude(1)
import * as cq from '@faicad/cq-compat'
let c0 = await cq.extrude(cq.rect(cq.Workplane('XY'), 1, 1), 1)
let cube = await cq.chamfer(cq.faces(c0, '>Z'), 0.1)
let result = cq.val(cube)
