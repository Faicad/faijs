// source: test_cadquery.py::TestCadQuery::testIbeam (var res, FINAL value)
// s = Workplane(Plane.XY()); pts = [(0,0),(0,10),(10,10),(10,9),(0.5,9),
//   (0.5,-9),(10,-9),(10,-10),(0,-10)]   (H=20, W=20, t=1)
// r = s.polyline(pts).mirrorY();  res = r.extrude(100)
// ref (out/ref/…testIbeam__res.step): vol 5800, bbox x[-10,10] y[-10,10]
//   z[0,100], topo f14/e36/v24/s1
//
// GOTCHA: `.fai.js` rejects a nested `await` in an argument position
// ("unsupported value expression: AwaitExpression"), so the chain is written as
// flat statements — no `cq.mirrorY(await cq.polyline(...))`.
import * as cq from '@faicad/faijs-cadquery'
let r = await cq.polyline(cq.Workplane('XY'), [[0, 0], [0, 10], [10, 10], [10, 9], [0.5, 9], [0.5, -9], [10, -9], [10, -10], [0, -10]])
let m = await cq.mirrorY(r)
let wp_out = await cq.extrude(m, 100)
let result = cq.val(wp_out)
