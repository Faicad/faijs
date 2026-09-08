// source: test_cadquery.py::TestCadQuery::testCylinderCentering (var s, final loop value)
// last iteration: centered=(False, False, False) -> bbox corner at origin
import * as cq from '@faicad/cq-compat'
let s = await cq.cylinder(cq.Workplane('XY'), 40, 10, { centered: [false, false, false] })
let result = cq.val(s)
