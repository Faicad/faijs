// source: test_cadquery.py::TestCadQuery::testFuzzyBoolOp (var box4)
// box4 = Workplane("XY", origin=(eps, 0.0)).box(1, 1, 1), eps = 1e-3
// WORKAROUND: cq-compat Workplane() takes no origin -> translate() the centred box.
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let box4 = await cq.translate(b, [1e-3, 0, 0])
let result = cq.val(box4)
