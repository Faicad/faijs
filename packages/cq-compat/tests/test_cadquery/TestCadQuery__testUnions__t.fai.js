// source: test_cadquery.py::TestCadQuery::testUnions (var t)
// for i in range(15): t = Workplane("XY").center(10.0*i, 0).rect(0.5,0.5).extrude(5.0)
// Final t = the i=14 iteration: box centred (140, 0), z 0..5.
// ref (cadquery 2.8.0): Solid, vol 1.25
import * as cq from '@faicad/cq-compat'
let s = cq.Workplane('XY')
let c = cq.center(s, 140, 0)
let r = cq.rect(c, 0.5, 0.5)
let t = await cq.extrude(r, 5)
let result = cq.val(t)
