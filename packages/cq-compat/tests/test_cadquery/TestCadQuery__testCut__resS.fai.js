// source: test_cadquery.py::TestCadQuery::testCut (var resS)
// resS = currentS.cut(toCut.val())
import * as cq from '@faicad/cq-compat'
let toCut = cq.extrude(cq.rect(cq.Workplane('XY'), 1.0, 1.0), 0.5)
let resS = cq.cut(cq.extrude(cq.rect(cq.Workplane('XY'), 2.0, 2.0), 0.5), cq.val(toCut))
let result = cq.val(resS)
