// source: test_cadquery.py::TestCadQuery::testCylinderCentering (var s0, last val=False)
import * as cq from '@faicad/cq-compat'
let s0 = await cq.cylinder(cq.Workplane('XY'), 40, 10, { centered: false })
let result = cq.val(s0)
