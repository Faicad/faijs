// source: test_cadquery.py::TestCadQuery::testUnionNoArgs (var objects1)
// objects1 = s.rect(2.0, 2.0).extrude(0.5)
import * as cq from '@faicad/cq-compat'
let objects1 = cq.extrude(cq.rect(cq.Workplane('XY'), 2.0, 2.0), 0.5)
let result = cq.val(objects1)
