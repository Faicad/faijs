// source: test_cadquery.py::TestCadQuery::testCylinderCenteringAndDirection (var s, final loop value)
// last iteration: direct=(0,0,-1), centered=(True, True, False)
import * as cq from '@faicad/cq-compat'
let s = await cq.cylinder(cq.Workplane('XY'), 40, 10, { direct: [0, 0, -1], centered: [true, true, false] })
let result = cq.val(s)
