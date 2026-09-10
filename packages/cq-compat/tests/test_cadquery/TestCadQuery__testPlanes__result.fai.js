// source: test_cadquery.py::TestCadQuery::testPlanes (var result)
// The plugin exports the LAST value of `result` = the Plane.bottom() chain:
//   Workplane(Plane.bottom()).rect(2, 4).extrude(0.5).faces(">Z").workplane()
//     .rect(1.5, 3.5, forConstruction=True).vertices().cskHole(0.125, 0.25, 82)
// Verified live (cadquery 2.8.0): for the bottom plane the cskHole removes NO
// material (vol stays 4.0, 6 faces) — the ref STEP has no holes. Mirror
// reproduces the observable ref geometry (extrude only).
// ref (cadquery 2.8.0): Compound, vol 4.0, 6 PLANE faces,
//   bbox [-1,-0.5,-2]..[1,0,2]
import * as cq from '@faicad/cq-compat'
let s = cq.rect(cq.Workplane('bottom'), 2, 4)
let e = await cq.extrude(s, 0.5)
let result = cq.val(e)
