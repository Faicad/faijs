// source: test_cadquery.py::TestCadQuery::testTwoWorkplanes (var t)
// t = r.faces(">Y").workplane().circle(0.125).cutBlind(-1.9)
import * as cq from '@faicad/cq-compat'
let r = cq.extrude(cq.circle(cq.vertices(cq.rect(cq.rect(cq.Workplane('XY'), 2.0, 2.0), 1.3, 1.3, { forConstruction: true })), 0.125), 0.5)
let t = cq.cutBlind(cq.circle(cq.workplane(cq.faces(r, '>Y')), 0.125), -1.9)
let result = cq.val(t)
