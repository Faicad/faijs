// source: test_cadquery.py::TestCadQuery::testMultiWireWorkplane (var r)
// r = Workplane(Plane.XY()).rect(2.0, 2.0).circle(0.25).extrude(0.5)
// Two pending wires in ONE extrusion: the circle is a hole in the rect face
// (7 faces). vol = 2*2*0.5 - pi*0.25^2*0.5 = 1.9018252295753189
// ref (cadquery 2.8.0): Solid, vol 1.9018252295753189
import * as cq from '@faicad/cq-compat'
let s = cq.Workplane('XY')
let p = cq.rect(s, 2, 2)
let c = cq.circle(p, 0.25)
let r = await cq.extrude(c, 0.5)
let result = cq.val(r)
