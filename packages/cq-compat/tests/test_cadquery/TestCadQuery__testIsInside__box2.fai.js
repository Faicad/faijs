// source: test_cadquery.py::TestCadQuery::testIsInside (var box2)
// box2 = Workplane(Plane.XY()).box(5, 5, 5)
import * as cq from '@faicad/cq-compat'
let box2 = await cq.box(cq.Workplane('XY'), 5, 5, 5)
let result = cq.val(box2)
