// source: test_cadquery.py::TestCadQuery::testSphereDefaults (var s)
// s = Workplane("XY").sphere(10)
import * as cq from '@faicad/faijs-cadquery'
let s = await cq.sphere(cq.Workplane('XY'), 10)
let result = cq.val(s)
