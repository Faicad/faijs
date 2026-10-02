// source: test_cadquery.py::TestCadQuery::testLocatedMoved (var box2)
// box at the point of `box2 = box.moved(loc)`: box had been located to (1,1,1)
// by the time box2 is computed, then moved by loc=(1,1,1) -> (2,2,2).
import * as cq from '@faicad/faijs-cadquery'
let base = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let at1 = await cq.moved(base, cq.Location([1, 1, 1]))
let box2 = await cq.moved(at1, cq.Location([1, 1, 1]))
let result = cq.val(box2)
