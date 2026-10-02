// source: test_cadquery.py::TestCadQuery::test_combineWithBase (var box)
import * as cq from '@faicad/faijs-cadquery'
let box = await cq.box(cq.Workplane(), 10, 10, 10)
let result = cq.val(box)
