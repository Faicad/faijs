// source: test_cadquery.py::TestCadQuery::test_cutFromBase (var sphere)
// sphere = Workplane().sphere(2) (standalone)
import * as cq from '@faicad/cq-compat'
let sphere = await cq.sphere(cq.Workplane(), 2)
let result = cq.val(sphere)
