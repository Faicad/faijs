// source: test_cadquery.py::TestCadQuery::testTwoWorkplanes (var r)
// r = s.rect(2.0,2.0).rect(1.3,1.3,forConstruction=True).vertices().circle(0.125).extrude(0.5)
// NOTE: cq-compat rect(forConstruction) overwrites the pending 2.0 profile (upstream keeps both)
// -> expect FAIL, records the pending-wires-as-list gap
import * as cq from '@faicad/cq-compat'
let r = cq.extrude(cq.circle(cq.vertices(cq.rect(cq.rect(cq.Workplane('XY'), 2.0, 2.0), 1.3, 1.3, { forConstruction: true })), 0.125), 0.5)
let result = cq.val(r)
