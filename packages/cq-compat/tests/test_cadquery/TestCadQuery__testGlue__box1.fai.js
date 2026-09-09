// source: test_cadquery.py::TestCadQuery::testGlue (var box1)
// box1 = Workplane("XY").rect(1, 1).extrude(2)
// ref (probed): vol 2.000000, bbox x,y in [-0.5,0.5], z in [0,2].
import * as cq from '@faicad/cq-compat'
let w1 = cq.rect(cq.Workplane('XY'), 1, 1)
let box1 = await cq.extrude(w1, 2)
let result = cq.val(box1)
