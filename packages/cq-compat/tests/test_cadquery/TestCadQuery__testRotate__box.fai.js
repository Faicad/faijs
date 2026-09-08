// source: test_cadquery.py::TestCadQuery::testRotate (var box)
// box = Workplane("XY").box(1, 1, 5); box.rotate((0,0,0),(1,0,0),90)  <- result DISCARDED upstream
import * as cq from '@faicad/cq-compat'
let box = cq.box(cq.Workplane('XY'), 1, 1, 5)
let result = cq.val(box)
