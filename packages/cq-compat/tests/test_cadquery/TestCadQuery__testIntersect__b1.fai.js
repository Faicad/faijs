// source: test_cadquery.py::TestCadQuery::testIntersect (var b1)
// b1 = Workplane("XY").box(1, 1, 1)
import * as cq from '@faicad/cq-compat'
let b1 = cq.box(cq.Workplane('XY'), 1, 1, 1)
let result = cq.val(b1)
