// source: test_cadquery.py::TestCadQuery::testRevolveCut (var box)
// ref (cadquery 2.8.0): vol 1000.000000, 6 faces, bbox [-5,-5,-5]..[5,5,5]
//   box = Workplane().box(10, 10, 10)   (plain base box)
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane(), 10, 10, 10)
let result = cq.val(box)
