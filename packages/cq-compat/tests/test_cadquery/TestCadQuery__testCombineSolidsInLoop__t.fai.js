// source: test_cadquery.py::TestCadQuery::testCombineSolidsInLoop (var t, last loop value i=14)
import * as cq from '@faicad/cq-compat'
let t = await cq.extrude(cq.rect(cq.center(cq.Workplane('XY'), 140.0, 0), 0.5, 0.5), 5.0)
let result = cq.val(t)
