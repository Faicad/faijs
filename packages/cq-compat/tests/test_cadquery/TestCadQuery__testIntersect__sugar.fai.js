// source: test_cadquery.py::TestCadQuery::testIntersect (var sugar — b1 & b2 sugar)
import * as cq from '@faicad/cq-compat'
let b1 = cq.box(cq.Workplane('XY'), 1, 1, 1)
let b2 = cq.translate(cq.box(cq.Workplane('XY'), 1, 1, 1), [0, 0, 0.5])
let sugar = cq.intersect(b1, b2)
let result = cq.val(sugar)
