// source: test_cadquery.py::TestCadQuery::testIntersect (var currentS)
import * as cq from '@faicad/cq-compat'
let currentS = cq.extrude(cq.rect(cq.Workplane('XY'), 2.0, 2.0), 0.5)
let result = cq.val(currentS)
