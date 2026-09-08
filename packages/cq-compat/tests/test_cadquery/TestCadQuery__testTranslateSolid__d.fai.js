// source: test_cadquery.py::TestCadQuery::testTranslateSolid (var d)
// d = c.translate(Vector(0, 0, 1.5))
import * as cq from '@faicad/cq-compat'
let d = cq.translate(cq.extrude(cq.rect(cq.Workplane('XY'), 1, 1), 1), [0, 0, 1.5])
let result = cq.val(d)
