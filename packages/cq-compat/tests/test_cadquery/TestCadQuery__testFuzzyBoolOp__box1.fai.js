// source: test_cadquery.py::TestCadQuery::testFuzzyBoolOp (var box1)
// box1 = Workplane("XY").box(1, 1, 1)
import * as cq from '@faicad/cq-compat'
let box1 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let result = cq.val(box1)
