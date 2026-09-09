// source: test_cadquery.py::TestCadQuery::testGlue (var obj)
// obj = Workplane("XY").rect(1, 1).extrude(2).moveTo(0, 2).rect(1, 1).extrude(2)
// ref (probed): vol 4.000000, com (0, 1, 1), bbox y in [-0.5, 2.5], z in [0,2].
// moveTo(0, 2) moves the CURRENT POINT, and upstream rect() is an eachpoint op:
// the second rect is built at (0, 2), not at the workplane origin. cq-compat
// mirrors that via eachPoints() (pushPoints > currentPoint > plane origin).
import * as cq from '@faicad/cq-compat'
let w1 = cq.rect(cq.Workplane('XY'), 1, 1)
let w2 = await cq.extrude(w1, 2)
let w3 = await cq.moveTo(w2, 0, 2)
let w4 = cq.rect(w3, 1, 1)
let obj = await cq.extrude(w4, 2)
let result = cq.val(obj)
