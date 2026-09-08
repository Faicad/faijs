// source: test_cadquery.py::TestCadQuery::testFuzzyBoolOp (var box3)
// box3 = Workplane("XY", origin=(2, 0, 0)).box(1, 1, 1)
// WORKAROUND: cq-compat Workplane() takes no origin -> translate() the centred box.
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let box3 = await cq.translate(b, [2, 0, 0])
let result = cq.val(box3)
