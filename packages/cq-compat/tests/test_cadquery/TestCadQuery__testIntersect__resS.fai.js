// source: test_cadquery.py::TestCadQuery::testIntersect (var resS — final re-assignment b1.intersect(b2))
import * as cq from '@faicad/cq-compat'
let b1 = cq.box(cq.Workplane('XY'), 1, 1, 1)
let b2 = cq.translate(cq.box(cq.Workplane('XY'), 1, 1, 1), [0, 0, 0.5])
let resS = cq.intersect(b1, b2)
let result = cq.val(resS)
