// source: test_cadquery.py::TestCadQuery::testBoxPointList (var s, combine=False final value)
// s = Workplane("XY").rect(4,4,forConstruction=True).vertices().box(0.25,0.25,0.25, combine=False)
import * as cq from '@faicad/cq-compat'
let s = cq.box(cq.rect(cq.Workplane('XY'), 4.0, 4.0, { forConstruction: true }), 0.25, 0.25, 0.25)
let result = cq.val(s)
