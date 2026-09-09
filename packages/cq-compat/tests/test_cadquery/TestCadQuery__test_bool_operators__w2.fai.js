// source: test_cadquery.py::TestCadQuery::test_bool_operators (var w2)
// w2 = Workplane().box(2, 2, 1)
// ref (cadquery 2.8.0): Solid, vol 4
import * as cq from '@faicad/cq-compat'
let w2 = await cq.box(cq.Workplane('XY'), 2, 2, 1)
let result = cq.val(w2)
