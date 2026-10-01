// source: test_cadquery.py::TestCadQuery::testSection (var box)
// box = Workplane("XY", origin=(1, 2, 3)).box(1, 1, 1)
// U16: cq-compat Workplane() ignores the origin kwarg — offset applied with
// translate() on the empty workplane (moves wp.origin).
import * as cq from '@faicad/cq-compat'
let p = await cq.translate(cq.Workplane('XY'), [1, 2, 3])
let box = await cq.box(p, 1, 1, 1)
let result = cq.val(box)
