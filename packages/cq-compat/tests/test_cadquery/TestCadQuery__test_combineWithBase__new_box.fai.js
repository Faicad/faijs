// source: test_cadquery.py::TestCadQuery::test_combineWithBase (var new_box)
// new_box = box._combineWithBase(sphere.val()) -> same fused solid
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane(), 10, 10, 10)
let wp0 = await cq.workplane(cq.faces(box, '>Z'))
let new_box = await cq.sphere(wp0, 2)
let result = cq.val(new_box)
