// source: test_cadquery.py::TestCadQuery::test_cutFromBase (var hoolow_box)
// hoolow_box = box._cutFromBase(sphere.val()) -> box minus center sphere
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane(), 10, 10, 10)
let sphere = await cq.sphere(cq.Workplane(), 2)
let hoolow_box = await cq.cut(box, sphere)
let result = cq.val(hoolow_box)
