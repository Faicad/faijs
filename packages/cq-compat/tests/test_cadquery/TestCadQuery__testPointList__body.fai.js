// source: test_cadquery.py::TestCadQuery::testPointList (var body)
// body = c.faces(">Z").workplane().pushPoints([(-0.3,0.3),(0.3,0.3),(0,0)]).circle(0.05).cutThruAll()
import * as cq from '@faicad/cq-compat'
let c = await cq.extrude(cq.rect(cq.Workplane('XY'), 1, 1), 1)
let w0 = await cq.workplane(cq.faces(c, '>Z'))
let w1 = cq.pushPoints(w0, [[-0.3, 0.3], [0.3, 0.3], [0, 0]])
let body = await cq.cutThruAll(cq.circle(w1, 0.05))
let result = cq.val(body)
