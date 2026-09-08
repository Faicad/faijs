// source: test_cadquery.py::TestCadQuery::testIntersect (var b2)
// b2 = Workplane("XY", origin=(0, 0, 0.5)).box(1, 1, 1)
// cq-compat Workplane() has no origin param -> centered box + translate is equivalent
import * as cq from '@faicad/cq-compat'
let b2 = cq.translate(cq.box(cq.Workplane('XY'), 1, 1, 1), [0, 0, 0.5])
let result = cq.val(b2)
