// source: test_cadquery.py::TestCadQuery::testIntersect (var toIntersect)
import * as cq from '@faicad/cq-compat'
let toIntersect = cq.extrude(cq.rect(cq.Workplane('XY'), 1.0, 1.0), 1)
let result = cq.val(toIntersect)
