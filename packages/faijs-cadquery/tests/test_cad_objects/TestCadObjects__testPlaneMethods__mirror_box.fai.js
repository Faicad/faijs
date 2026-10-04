// source: test_cad_objects.py::TestCadObjects::testPlaneMethods (var mirror_box)
// mirror_box = Workplane(p.mirrorInPlane([Solid.makeBox(1, 1, 1)], "Y")[0])
// Same corner-at-origin box; mirrorInPlane axis="Y" reflects about the plane's
// Y axis (local x AND z flip — GOTCHA, probe-verified against cadquery 2.8.0).
// Expected vertices:
// (0,0,1),(0,0,0),(0,-1,1),(0,-1,0),(-1,0,1),(-1,0,0),(-1,-1,1),(-1,-1,0).
// ref (cadquery 2.8.0): box vol 1, bbox x[-1,0] y[-1,0] z[0,1].
import * as cq from '@faicad/faijs-cadquery'
let plane = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, -1], normal: [0, 1, 0] }
let box = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: false })
let result = cq.mirrorInPlane(plane, box, 'Y')
