// source: test_cadquery.py::TestCadQuery::test_iterators (var s)
// s = Workplane().box(1, 1, 1).val()   (first assignment in the test)
// ref (cadquery 2.8.0): Solid, vol 1
import * as cq from '@faicad/cq-compat'
let s = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let result = cq.val(s)
