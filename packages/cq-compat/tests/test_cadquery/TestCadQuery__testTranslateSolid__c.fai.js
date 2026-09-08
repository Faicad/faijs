// source: test_cadquery.py::TestCadQuery::testTranslateSolid (var c)
// c = CQ(makeUnitCube())  -> stub: rect(1,1).extrude(1)
import * as cq from '@faicad/cq-compat'
let c = cq.extrude(cq.rect(cq.Workplane('XY'), 1, 1), 1)
let result = cq.val(c)
