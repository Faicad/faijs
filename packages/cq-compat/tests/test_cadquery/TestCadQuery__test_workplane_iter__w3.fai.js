// source: test_cadquery.py::TestCadQuery::test_workplane_iter (var w3)
// w3 = w1.box(1, 1, 1, combine=False): upstream puts both boxes on the stack
// and val() returns the FIRST one — a single centered box at (-10, 0, 0).
// ref (cadquery 2.8.0): Solid, vol 1, bbox [-10.5, -0.5, -0.5, -9.5, 0.5, 0.5]
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let w3 = await cq.translate(b, [-10, 0, 0])
let result = cq.val(w3)
