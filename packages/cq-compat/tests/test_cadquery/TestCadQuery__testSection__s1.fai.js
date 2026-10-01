// source: test_cadquery.py::TestCadQuery::testSection (var s1)
// box = Workplane("XY", origin=(1, 2, 3)).box(1, 1, 1)
// s1  = box.section()            → plane through the workplane origin, z = 3
import * as cq from '@faicad/cq-compat'
let p = await cq.translate(cq.Workplane('XY'), [1, 2, 3])
let box = await cq.box(p, 1, 1, 1)
let s1 = await cq.section(box)
let result = cq.val(s1)
