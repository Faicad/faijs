// source: test_cadquery.py::TestCadQuery::testCylinderCentering (var s1)
import * as cq from '@faicad/cq-compat'
let s1 = await cq.cylinder(cq.Workplane('XY'), 40, 10, { centered: [false, false, false] })
let result = cq.val(s1)
