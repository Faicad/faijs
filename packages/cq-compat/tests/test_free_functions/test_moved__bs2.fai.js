// source: test_free_functions.py::test_moved (var bs2)
// ref (cadquery 2.8.0): vol 2.000000, 12 faces, com (0,0,0.5)
//   bs2 = b.moved((l1, l2))  -- the sequence form
//
import * as cq from '@faicad/cq-compat'
let wp0 = cq.Workplane('XY')
// func.box(1,1,1) is xy-centred and sits on z=0 (z 0..1) - cq.box is centred on
// the workplane origin, so lift it by half the height to match.
let b0 = await cq.box(wp0, 1, 1, 1)
let b = await cq.translate(b0, [0, 0, 0.5])
// func.sphere(d) takes the DIAMETER: sphere(0.1) -> radius 0.05 (vol 0.000524).
let sp = await cq.sphere(wp0, 0.05)
let l1 = cq.Location([-1, 0, 0])
let l2 = cq.Location([1, 0, 0])
let bs2 = await cq.moved(b, [l1, l2])
let result = cq.val(bs2)
