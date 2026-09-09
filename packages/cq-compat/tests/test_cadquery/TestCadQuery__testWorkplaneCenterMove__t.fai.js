// source: test_cadquery.py::TestCadQuery::testWorkplaneCenterMove (var t)
// s = Workplane("XY").box(1,1,1).faces(">Z").workplane().center(-0.5,-0.5)
// t = s.circle(0.25).extrude(0.2)   (boss centred on a corner of the top face)
// vol = 1 + pi*0.25^2*0.2 = 1.0392699081698722
// ref (cadquery 2.8.0): Compound, vol 1.0392699081698722
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let w = await cq.workplane(cq.faces(b, '>Z'))
let c = cq.center(w, -0.5, -0.5)
let t = await cq.extrude(cq.circle(c, 0.25), 0.2)
let result = cq.val(t)
