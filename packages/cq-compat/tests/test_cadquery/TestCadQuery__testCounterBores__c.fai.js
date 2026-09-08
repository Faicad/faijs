// source: test_cadquery.py::TestCadQuery::testCounterBores (var c, cboreHole depth=0.75)
// c = CQ(makeCube(3.0)).faces(">Z").workplane().pushPoints(pnts).cboreHole(0.1, 0.25, 0.25, 0.75)
import * as cq from '@faicad/cq-compat'
let c = cq.extrude(cq.rect(cq.Workplane('XY'), 3, 3), 3)
c = cq.cboreHole(cq.pushPoints(cq.workplane(cq.faces(c, '>Z')), [[-1.0, -1.0], [0.0, 0.0], [1.0, 1.0]]), 0.1, 0.25, 0.25, 0.75)
let result = cq.val(c)
