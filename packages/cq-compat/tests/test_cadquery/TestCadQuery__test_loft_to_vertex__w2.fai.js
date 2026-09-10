// source: test_cadquery.py::TestCadQuery::test_loft_to_vertex (var w2)
// c = compound(f1, v1)  with f1 = plane(1, 1), v1 = vertex(0, 0, 1)
// w2 = Workplane().add(c).loft()
// Lofting the compound yields the same ruled pyramid as w1 (both are 1 solid).
// ref (cadquery 2.8.0): Solid, vol 0.3333333333333335
import * as cq from '@faicad/cq-compat'
let w0 = await cq.rect(cq.Workplane('XY'), 1, 1)
let w2 = await cq.loft(w0, { endPoint: [0, 0, 1] })
let result = cq.val(w2)
