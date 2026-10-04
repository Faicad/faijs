// source: test_cad_objects.py::TestCadObjects::testPlaneMethods (var local_box)
// p = Plane(origin=(0, 0, 0), xDir=(1, 0, 0), normal=(0, 1, 0))
// local_box = Workplane(p.toLocalCoords(Solid.makeBox(1, 1, 1)))
// CadQuery Solid.makeBox(1,1,1) is corner-at-origin (x,y,z in [0,1]); faijs
// cq.box(..., {centered:false}) reproduces that. The local frame maps world
// (x,y,z) -> (x, -z, y), so the box vertices land at
// (0,-1,0),(0,0,0),(0,-1,1),(0,0,1),(1,-1,0),(1,0,0),(1,-1,1),(1,0,1).
// ref (cadquery 2.8.0): box vol 1, bbox x[0,1] y[-1,0] z[0,1].
import * as cq from '@faicad/faijs-cadquery'
let plane = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, -1], normal: [0, 1, 0] }
let box = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: false })
let result = cq.toLocalCoords(plane, box)
