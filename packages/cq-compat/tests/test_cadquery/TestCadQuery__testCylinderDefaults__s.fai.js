// source: test_cadquery.py::TestCadQuery::testCylinderDefaults (var s)
// s = Workplane("XY").cylinder(20, 10)
import * as cq from '@faicad/cq-compat'
let s = await cq.cylinder(cq.Workplane('XY'), 20, 10)
let result = cq.val(s)
