// source: test_cadquery.py::TestCadQuery::testUnions (var resS)
// resS = currentS.union(toUnion)  — 2x2x0.5 plate + 1x1x1 boss, overlapping in
// z 0..0.5: vol = 2 + 1 - 0.5 = 2.5
// ref (cadquery 2.8.0): Compound, vol 2.5
import * as cq from '@faicad/cq-compat'
let s = cq.Workplane('XY')
let currentS = await cq.extrude(cq.rect(s, 2, 2), 0.5)
let toUnion = await cq.extrude(cq.rect(s, 1, 1), 1)
let resS = await cq.union(currentS, toUnion)
let result = cq.val(resS)
