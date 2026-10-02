// source: test_cadquery.py::TestCadQuery::testText (var box)
// box = Workplane("XY").box(4, 4, 0.5)
import * as cq from '@faicad/faijs-cadquery'
let box = await cq.box(cq.Workplane('XY'), 4, 4, 0.5)
let result = cq.val(box)
