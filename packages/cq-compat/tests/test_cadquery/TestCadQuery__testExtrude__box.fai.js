// source: test_cadquery.py::TestCadQuery::testExtrude (var box)
// box = Workplane().box(5, 5, 5)
// NOTE: the other vars of this case need extrude(both=) / extrude(combine="cut"|"s"),
// which cq-compat does not implement yet (tracked as op:extrude.both / op:extrude.combine).
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane('XY'), 5, 5, 5)
let result = cq.val(box)
