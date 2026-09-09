// source: test_cadquery.py::TestCadQuery::testUnions (var toUnion)
// toUnion = s.rect(1.0, 1.0).extrude(1.0)   (s is the bare workplane — fresh extrude)
// ref (cadquery 2.8.0): Solid, vol 1
import * as cq from '@faicad/cq-compat'
let s = cq.Workplane('XY')
let toUnion = await cq.extrude(cq.rect(s, 1, 1), 1)
let result = cq.val(toUnion)
