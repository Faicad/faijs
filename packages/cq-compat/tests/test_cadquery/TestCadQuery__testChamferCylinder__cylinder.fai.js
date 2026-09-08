// source: test_cadquery.py::TestCadQuery::testChamferCylinder (var cylinder)
// cylinder = Workplane("XY").circle(1).extrude(1).faces(">Z").chamfer(0.1)
import * as cq from '@faicad/cq-compat'
let c0 = await cq.extrude(cq.circle(cq.Workplane('XY'), 1), 1)
let cylinder = await cq.chamfer(cq.faces(c0, '>Z'), 0.1)
let result = cq.val(cylinder)
