// source: test_cadquery.py::TestCadQuery::testFuzzyBoolOp (var res)
// res = box1.union(box2) with a 1e-3 gap -> NOT fused (upstream asserts 2 solids),
// so the exported val() is the resulting compound of two cubes.
// WORKAROUND: box2 origin via translate() (cq-compat Workplane() takes no origin).
import * as cq from '@faicad/cq-compat'
let box1 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let b = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let box2 = await cq.translate(b, [1 + 1e-3, 0, 0])
let res = await cq.union(box1, box2)
let result = cq.val(res)
