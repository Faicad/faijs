// source: test_cadquery.py::TestCadQuery::testPopPending (var w5)
// w5 = Workplane().circle(1).extrude(1)   (same body as w4; the assertion under
// test is that cutBlind(-1) raises because there is no pending wire)
import * as cq from '@faicad/cq-compat'
let w5 = await cq.extrude(cq.circle(cq.Workplane('XY'), 1), 1)
let result = cq.val(w5)
