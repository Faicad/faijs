// source: test_cadquery.py::TestCadQuery::testSpherePointList (var s)
// s = ...sphere(0.25, combine=False): upstream val() = objects[0] = FIRST sphere.
// Ref STEP therefore holds one sphere at the first rect corner (-2,-2).
// The full 4-sphere compound is covered by src/p4-ops.test.ts.
import * as cq from '@faicad/cq-compat'
let wp0 = cq.pushPoints(cq.Workplane('XY'), [[-2, -2]])
let s = await cq.sphere(wp0, 0.25, { combine: false })
let result = cq.val(s)
