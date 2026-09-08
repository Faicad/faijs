// source: test_cadquery.py::TestCadQuery::testCut (var toCut)
// toCut = Workplane(Plane.XY()).rect(1.0, 1.0).extrude(0.5)
import * as cq from '@faicad/cq-compat'
let toCut = cq.extrude(cq.rect(cq.Workplane('XY'), 1.0, 1.0), 0.5)
let result = cq.val(toCut)
