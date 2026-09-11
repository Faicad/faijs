// source: test_cadquery.py::TestCadQuery::testCutToFaceOffsetNOTIMPLEMENTEDYET (var r)
// r = s.rect(2.0,2.0).rect(1.3,1.3,forConstruction=True).vertices().circle(0.125).extrude(0.5)
// The cutToOffsetFromFace() call is wrapped in try/except (NOT IMPLEMENTED
// upstream either) and fails, so the exported r is the extruded plate —
// identical geometry to testTwoWorkplanes (var r): outer 2x2, four corner
// holes Ø0.25, z [0, 0.5].
// ref (cadquery 2.8.0 probe): vol 1.901825, 10 faces
import * as cq from '@faicad/cq-compat'
let r = cq.extrude(cq.circle(cq.vertices(cq.rect(cq.rect(cq.Workplane('XY'), 2.0, 2.0), 1.3, 1.3, { forConstruction: true })), 0.125), 0.5)
let result = cq.val(r)
