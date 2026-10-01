// source: test_cadquery.py::TestCadQuery::testSlot2D (var box)
// box = Workplane("XY").box(5, 5, 1)   — the fixture the slots are cut into
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane('XY'), 5, 5, 1)
let result = cq.val(box)
