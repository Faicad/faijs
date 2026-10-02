// source: test_cadquery.py::TestCadQuery::testEachpoint (var sph)
// sph = Workplane().sphere(1.0)  (eachpoint item; saved ref is the plain sphere)
// ref anchor: vol=4.18879020479, topo f1/e3/v2/s1
import * as cq from '@faicad/faijs-cadquery'
let sph = await cq.sphere(cq.Workplane(), 1)
let result = cq.val(sph)
