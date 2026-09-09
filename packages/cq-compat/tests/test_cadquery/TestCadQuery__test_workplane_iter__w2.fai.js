// source: test_cadquery.py::TestCadQuery::test_workplane_iter (var w2)
// w2 = w1.box(1, 1, 1) with w1 = Workplane().pushPoints([(-10, 0), (10, 0)])
// Two disjoint centered boxes at x=-10 and x=10.
// ref (cadquery 2.8.0): Compound (2 solids), vol 2
import * as cq from '@faicad/cq-compat'
let w1 = cq.pushPoints(cq.Workplane('XY'), [[-10, 0], [10, 0]])
let w2 = await cq.box(w1, 1, 1, 1)
let result = cq.val(w2)
