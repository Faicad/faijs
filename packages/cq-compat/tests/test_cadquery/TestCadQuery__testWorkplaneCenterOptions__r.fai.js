// source: test_cadquery.py::TestCadQuery::testWorkplaneCenterOptions (var r — LAST assignment)
// r is re-assigned for every plane/centerOption combination; the harness exports
// the final one:
//   r = Workplane("XZ").polyline(pts).close().extrude(10.0)
//   pts = [(0,0),(90,0),(90,30),(30,30),(30,60),(0,60)]
// ref (probed): vol 36000.000000, com (37.5, -5, 22.5),
//   bbox x [0,90], y [-10,0], z [0,60] — the "XZ" plane normal is -Y, so the
//   extrusion runs from y=0 down to y=-10 and the polyline y becomes world z.
import * as cq from '@faicad/cq-compat'
let pts = [[0, 0], [90, 0], [90, 30], [30, 30], [30, 60], [0, 60]]
let w1 = cq.polyline(cq.Workplane('XZ'), pts)
let w2 = await cq.close(w1)
let r = await cq.extrude(w2, 10)
let result = cq.val(r)
