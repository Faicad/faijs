// source: test_cadquery.py::TestCadQuery::testPopPending (var w4)
// w4 = Workplane().circle(1).extrude(1)
import * as cq from '@faicad/cq-compat'
let w4 = await cq.extrude(cq.circle(cq.Workplane('XY'), 1), 1)
let result = cq.val(w4)
