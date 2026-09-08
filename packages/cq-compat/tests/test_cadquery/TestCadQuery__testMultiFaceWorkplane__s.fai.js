// source: test_cadquery.py::TestCadQuery::testMultiFaceWorkplane (var s)
// s = Workplane("XY").box(1,1,1).faces(">Z").rect(1,0.5).cutBlind(-0.2)
import * as cq from '@faicad/cq-compat'
let s = cq.cutBlind(cq.rect(cq.faces(cq.box(cq.Workplane('XY'), 1, 1, 1), '>Z'), 1, 0.5), -0.2)
let result = cq.val(s)
