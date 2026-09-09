// source: test_cadquery.py::TestCadQuery::testLoft (var s)
// ref (cadquery 2.8.0): vol 114.450906, 7 faces, 1 solid
//   s = Workplane("XY").circle(4.0).workplane(5.0).rect(2.0, 2.0).loft()
//   (upstream workplane(5.0): first positional arg is offset; loft default ruled=False)
import * as cq from '@faicad/cq-compat'
let w1 = cq.circle(cq.Workplane('XY'), 4)
let w2 = await cq.workplane(w1, { offset: 5 })
let w3 = cq.rect(w2, 2, 2)
let s = await cq.loft(w3)
let result = cq.val(s)
