// source: test_cadquery.py::TestCadQuery::testClosedShell (var s3)
// pts = [(1.0, 0.0), (0.3, 0.2), (0.0, 0.0), (0.3, -0.1), (1.0, -0.03)]
// s3 = Workplane().polyline(pts).close().extrude(1).shell(-0.05)
// Closed hollow of a non-convex prism, walls inward 0.05.
// ref (probed): vol 0.09914449156445816.
import * as cq from '@faicad/cq-compat'
let pts = [[1, 0], [0.3, 0.2], [0, 0], [0.3, -0.1], [1, -0.03]]
let w0 = cq.polyline(cq.Workplane(), pts)
let w1 = await cq.close(w0)
let p = await cq.extrude(w1, 1)
let s3 = await cq.shell(p, -0.05)
let result = cq.val(s3)
