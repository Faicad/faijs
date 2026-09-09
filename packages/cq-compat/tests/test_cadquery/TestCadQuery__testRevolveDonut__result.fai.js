// source: test_cadquery.py::TestCadQuery::testRevolveDonut (var result)
// ref (cadquery 2.8.0): vol 12566.370614, 4 faces, bbox [-5,-5,-25]..[45,5,25]
//   Workplane("XY").rect(10,10,True).revolve(360, (20,0), (20,10))
//   = square torus: axis parallel to Y at x=20, profile 10..30 away from it
import * as cq from '@faicad/cq-compat'
let wp1 = cq.rect(cq.Workplane('XY'), 10, 10)
let wp2 = await cq.revolve(wp1, 360, [20, 0], [20, 10])
let result = cq.val(wp2)
