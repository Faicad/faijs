// source: test_cadquery.py::TestCadQuery::testNestedCircle (var s)
// s = Workplane("XY").box(40,40,5).pushPoints([(10,0),(0,10)]).circle(4).circle(2).extrude(4)
// NOTE: upstream keeps TWO pending wires (annulus); cq-compat pendingCircle is single-valued
// and the second circle(2) overwrites circle(4) — expected FAIL records that gap.
import * as cq from '@faicad/cq-compat'
let s = cq.extrude(cq.circle(cq.circle(cq.pushPoints(cq.box(cq.Workplane('XY'), 40, 40, 5), [[10, 0], [0, 10]])), 4), 2)
let result = cq.val(s)
