// source: test_cadquery.py::TestCadQuery::testClose (var b)
// b = Workplane(Plane.XY()).sagittaArc((10,0),2).sagittaArc((0,0),2).close().extrude(2)
// ref (probed): vol 55.00293157574942 (exactly 2x a — opposite bulges).
import * as cq from '@faicad/cq-compat'
let w0 = cq.sagittaArc(cq.Workplane('XY'), [10, 0], 2)
let w1 = await cq.sagittaArc(w0, [0, 0], 2)
let w2 = await cq.close(w1)
let b = await cq.extrude(w2, 2)
let result = cq.val(b)
