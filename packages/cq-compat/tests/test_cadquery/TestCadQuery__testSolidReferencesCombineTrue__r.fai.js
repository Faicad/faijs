// source: test_cadquery.py::TestCadQuery::testSolidReferencesCombineTrue (var r)
// r = Workplane(Plane.XY()).rect(2.0, 2.0).extrude(0.5)
// ref (cadquery 2.8.0): Solid, vol 2
import * as cq from '@faicad/cq-compat'
let s = cq.Workplane('XY')
let r = await cq.extrude(cq.rect(s, 2, 2), 0.5)
let result = cq.val(r)
