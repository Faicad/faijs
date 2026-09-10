// source: test_cadquery.py::TestCadQuery::testClose (var obj1)
// obj1 = Workplane("XY", origin=(0,0,-1.5)).moveTo(5,0)
//        .threePointArc((0,2.5),(-5,0)).threePointArc((0,-2.5),(5,0))
//        .close().extrude(3)
// ref (probed): vol 104.8348167191279, 4 faces.
// U16: cq-compat Workplane() ignores the origin kwarg — offset applied with
// translate() on the empty workplane (moves wp.origin).
import * as cq from '@faicad/cq-compat'
let p = await cq.translate(cq.Workplane('XY'), [0, 0, -1.5])
let w0 = await cq.moveTo(p, 5, 0)
let w1 = await cq.threePointArc(w0, [0, 2.5], [-5, 0])
let w2 = await cq.threePointArc(w1, [0, -2.5], [5, 0])
let w3 = await cq.close(w2)
let obj1 = await cq.extrude(w3, 3)
let result = cq.val(obj1)
