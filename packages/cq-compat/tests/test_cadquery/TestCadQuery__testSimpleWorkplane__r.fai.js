// source: test_cadquery.py::TestCadQuery::testSimpleWorkplane (var r)
// r = s.rect(2.0,2.0).extrude(0.5).faces(">Z").workplane().circle(0.25).cutBlind(-1.0)
import * as cq from '@faicad/cq-compat'
let r = cq.cutBlind(cq.circle(cq.workplane(cq.faces(cq.extrude(cq.rect(cq.Workplane('XY'), 2.0, 2.0), 0.5), '>Z')), 0.25), -1.0)
let result = cq.val(r)
