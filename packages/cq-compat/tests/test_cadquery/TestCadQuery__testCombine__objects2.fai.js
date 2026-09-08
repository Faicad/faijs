// source: test_cadquery.py::TestCadQuery::testCombine (var objects2)
// objects2 = objects1.add(small box translated (0,0,0.5)).combine()
import * as cq from '@faicad/cq-compat'
let a = await cq.extrude(cq.rect(cq.Workplane('XY'), 2.0, 2.0), 0.5)
let b0 = await cq.extrude(cq.rect(cq.Workplane('XY'), 1.0, 1.0), 0.5)
let b = await cq.translate(b0, [0, 0, 0.5])
let objects2 = await cq.union(a, b)
let result = cq.val(objects2)
