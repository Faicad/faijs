// source: test_cadquery.py::TestCadQuery::testFillet (var c)
// c = CQ(makeUnitCube()).faces(">Z").workplane().circle(0.25).extrude(0.25, True).edges("|Z").fillet(0.2)
// makeUnitCube stub: rect(1,1).extrude(1) (tests/__init__.py makeCube(1.0, centered=True))
import * as cq from '@faicad/cq-compat'
let c = cq.extrude(cq.rect(cq.Workplane('XY'), 1, 1), 1)
c = cq.fillet(cq.edges(cq.extrude(cq.circle(cq.workplane(cq.faces(c, '>Z')), 0.25), 0.25), '|Z'), 0.2)
let result = cq.val(c)
