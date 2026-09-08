// source: test_cadquery.py::TestCadQuery::test_cutFromBase (var box)
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane(), 10, 10, 10)
let result = cq.val(box)
