// source: test_cadquery.py::TestCadQuery::test_combineWithBase (var sphere)
// sphere = box.faces(">Z").sphere(2) -> sphere fused onto the box top face
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane(), 10, 10, 10)
let wp0 = await cq.workplane(cq.faces(box, '>Z'))
let sphere = await cq.sphere(wp0, 2)
let result = cq.val(sphere)
