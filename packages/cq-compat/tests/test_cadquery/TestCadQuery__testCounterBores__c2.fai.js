// source: test_cadquery.py::TestCadQuery::testCounterBores (var c2, cboreHole depth=None auto)
// c2 = CQ(makeCube(3.0)).faces(">Z").workplane().pushPoints(pnts).cboreHole(0.1, 0.25, 0.25)
import * as cq from '@faicad/cq-compat'
let c2 = cq.extrude(cq.rect(cq.Workplane('XY'), 3, 3), 3)
c2 = cq.cboreHole(cq.pushPoints(cq.workplane(cq.faces(c2, '>Z')), [[-1.0, -1.0], [0.0, 0.0], [1.0, 1.0]]), 0.1, 0.25, 0.25)
let result = cq.val(c2)
