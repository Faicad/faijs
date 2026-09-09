// source: test_cadquery.py::TestCadQuery::test_iterators (var c)
// c = w.val() where w = Workplane().pushPoints([(0, 0), (2, 0)]).box(1, 1, 1)
// Same compound as the exported w.
// ref (cadquery 2.8.0): Compound (2 solids), vol 2
import * as cq from '@faicad/cq-compat'
let p = cq.pushPoints(cq.Workplane('XY'), [[0, 0], [2, 0]])
let w = await cq.box(p, 1, 1, 1)
let c = cq.val(w)
let result = c
