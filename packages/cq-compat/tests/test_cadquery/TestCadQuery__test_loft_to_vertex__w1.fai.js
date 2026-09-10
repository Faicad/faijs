// source: test_cadquery.py::TestCadQuery::test_loft_to_vertex (var w1)
// f1 = plane(1, 1); v1 = vertex(0, 0, 1)
// w1 = Workplane().add(f1).add(v1).loft()
// Face-to-vertex loft -> ruled pyramid, apex (0,0,1).
// ref (cadquery 2.8.0): Solid, vol 0.3333333333333335, 1 solid
import * as cq from '@faicad/cq-compat'
let w0 = await cq.rect(cq.Workplane('XY'), 1, 1)
let w1 = await cq.loft(w0, { endPoint: [0, 0, 1] })
let result = cq.val(w1)
