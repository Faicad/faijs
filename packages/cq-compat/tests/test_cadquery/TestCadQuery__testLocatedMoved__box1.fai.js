// source: test_cadquery.py::TestCadQuery::testLocatedMoved (var box1)
// box = Solid.makeBox(1,1,1, Vector(-0.5,-0.5,-0.5))  -> centered at origin
// loc = Location(Vector(1,1,1))
// box1 = box.located(loc)  -> box1 center (1,1,1); box still at origin here.
import * as cq from '@faicad/cq-compat'
let base = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let box1 = await cq.moved(base, cq.Location([1, 1, 1]))
let result = cq.val(box1)
