// source: test_cadquery.py::TestCadQuery::testUnions (var oo)
// `for oo in o: s = s.union(oo)` — final oo = o[14], the same box as t.
// ref (cadquery 2.8.0): Solid, vol 1.25
import * as cq from '@faicad/cq-compat'
let s = cq.Workplane('XY')
let c = cq.center(s, 140, 0)
let r = cq.rect(c, 0.5, 0.5)
let oo = await cq.extrude(r, 5)
let result = cq.val(oo)
