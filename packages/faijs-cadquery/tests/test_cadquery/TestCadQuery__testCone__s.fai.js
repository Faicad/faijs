// source: test_cadquery.py::TestCadQuery::testCone (var s, FINAL value)
// s = Solid.makeCone(0, 1.0, 2.0)  — RADII (not diameters): radius1 = 0 is the
// BASE (z=0) radius, so this is an APEX-DOWN cone (centroid z = 1.5, not 0.5).
// ref (out/ref/…testCone__s.step): vol 2.09439510239, com z 1.5,
// bbox x[-1,1] y[-1,1] z[0,2], topo f2/e3/v2/s1
import * as cq from '@faicad/faijs-cadquery'
let result = await cq.solidMakeCone(0, 1.0, 2.0)
