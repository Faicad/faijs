// source: test_cadquery.py::TestCadQuery::testIsInside (var box1)
// box1 = Workplane(Plane.XY()).box(10, 10, 10)
import * as cq from '@faicad/cq-compat'
let box1 = await cq.box(cq.Workplane('XY'), 10, 10, 10)
let result = cq.val(box1)
