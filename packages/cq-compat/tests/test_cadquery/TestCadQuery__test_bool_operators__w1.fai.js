// source: test_cadquery.py::TestCadQuery::test_bool_operators (var w1)
// w1 = Workplane().box(1, 1, 2)
// ref (cadquery 2.8.0): Solid, vol 2
import * as cq from '@faicad/cq-compat'
let w1 = await cq.box(cq.Workplane('XY'), 1, 1, 2)
let result = cq.val(w1)
