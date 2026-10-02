// source: test_cadquery.py::TestCadQuery::testRotateAboutCenter (var r)
// r = Workplane().box(1, 1, 1).rotateAboutCenter((1, 0, 0), 20)
import * as cq from '@faicad/faijs-cadquery'
let b = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let r = await cq.rotateAboutCenter(b, [1, 0, 0], 20)
let result = cq.val(r)
