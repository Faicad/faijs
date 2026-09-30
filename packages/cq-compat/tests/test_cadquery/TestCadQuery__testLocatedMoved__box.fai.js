// source: test_cadquery.py::TestCadQuery::testLocatedMoved (var box, final state)
// box = Solid.makeBox(1,1,1, Vector(-0.5,-0.5,-0.5)) centered at origin
// box1 = box.located(loc=(1,1,1))            -> box still (0,0,0)
// box.locate(loc)                            -> box becomes (1,1,1)
// box2 = box.moved(loc)                       -> (2,2,2)
// box.move(loc)                               -> box becomes (2,2,2)
// Final exported box center = (2,2,2).
import * as cq from '@faicad/cq-compat'
let base = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let box = await cq.moved(base, cq.Location([1, 1, 1]))
box = await cq.moved(box, cq.Location([1, 1, 1]))
let result = cq.val(box)
