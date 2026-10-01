// source: test_cadquery.py::TestCadQuery::testSection (var s2)
// box = Workplane("XY", origin=(1, 2, 3)).box(1, 1, 1)
// s2  = box.section(0.5)         → plane offset +0.5 along +Z, i.e. z = 3.5
//       (exactly the box top face — upstream still reports area 1)
import * as cq from '@faicad/cq-compat'
let p = await cq.translate(cq.Workplane('XY'), [1, 2, 3])
let box = await cq.box(p, 1, 1, 1)
let s2 = await cq.section(box, 0.5)
let result = cq.val(s2)
