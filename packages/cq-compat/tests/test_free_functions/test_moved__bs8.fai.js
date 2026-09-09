// source: test_free_functions.py::test_moved (var bs8)
// ref (cadquery 2.8.0): vol 1.000000, 6 faces, com (0,0,0.5)
//   bs8 = b.moved(Location((0,0,0), (-45,0,0))).moved(rx=45)  -- net identity
//
import * as cq from '@faicad/cq-compat'
let wp0 = cq.Workplane('XY')
// func.box(1,1,1) is xy-centred and sits on z=0 (z 0..1) - cq.box is centred on
// the workplane origin, so lift it by half the height to match.
let b0 = await cq.box(wp0, 1, 1, 1)
let b = await cq.translate(b0, [0, 0, 0.5])
// func.sphere(d) takes the DIAMETER: sphere(0.1) -> radius 0.05 (vol 0.000524).
let sp = await cq.sphere(wp0, 0.05)
let m1 = await cq.moved(b, cq.Location([0, 0, 0], [-45, 0, 0]))
let bs8 = await cq.moved(m1, { rx: 45 })
let result = cq.val(bs8)
