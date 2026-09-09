// source: test_cadquery.py::TestCadQuery::testUnions (var sugar2)
// sugar2 = currentS + toUnion   (__add__ sugar — same geometry as resS)
// ref (cadquery 2.8.0): Compound, vol 2.5
import * as cq from '@faicad/cq-compat'
let s = cq.Workplane('XY')
let currentS = await cq.extrude(cq.rect(s, 2, 2), 0.5)
let toUnion = await cq.extrude(cq.rect(s, 1, 1), 1)
let sugar2 = await cq.union(currentS, toUnion)
let result = cq.val(sugar2)
