// source: test_cadquery.py::TestCadQuery::testBoxPointList (var s, FINAL value)
// s = Workplane("XY").rect(4,4,forConstruction=True).vertices().box(0.25,0.25,0.25, combine=False)
// upstream val() = objects[0] = FIRST box (corner-vertex at (-2,-2)).
// The full 4-cube compound is covered by src/p4-ops.test.ts.
import * as cq from '@faicad/cq-compat'
let wp0 = cq.pushPoints(cq.Workplane('XY'), [[-2, -2]])
let s = await cq.box(wp0, 0.25, 0.25, 0.25, { combine: false })
let result = cq.val(s)
