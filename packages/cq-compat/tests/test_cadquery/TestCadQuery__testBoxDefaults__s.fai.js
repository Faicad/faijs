// source: test_cadquery.py::TestCadQuery::testBoxDefaults (var s)
// s = Workplane("XY").box(2, 3, 4)
import * as cq from '@faicad/cq-compat'
let s = cq.box(cq.Workplane('XY'), 2, 3, 4)
let result = cq.val(s)
