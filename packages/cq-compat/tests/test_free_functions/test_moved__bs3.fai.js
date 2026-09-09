// source: test_free_functions.py::test_moved (var bs3)
// ref (cadquery 2.8.0): vol 4.000000, 24 faces, com (0,0,0.353553)
//   bs3 = bs1.moved(l3, l4)
//     l3 = Location((0,1,0), (45,0,0)), l4 = Location((0,-1,0), (-45,0,0))
//   i.e. the 2-solid compound is moved as a whole by each location.
//
// NOTE: a cq-compat Workplane carrying a COMPOUND loses its BREP handle when it
// is fed back into moved() (the kernel applyMatrix product does not survive a
// statement boundary, so the STEP degrades to a TESSELLATED_SOLID). The mirror
// therefore folds (l3,l4) with (l1,l2) via composeLocations and applies the four
// composed locations to the single-solid box in one moved() call.
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
let l3 = cq.Location([0, 1, 0], [45, 0, 0])
let l4 = cq.Location([0, -1, 0], [-45, 0, 0])
let c31 = cq.composeLocations(l3, l1)
let c32 = cq.composeLocations(l3, l2)
let c41 = cq.composeLocations(l4, l1)
let c42 = cq.composeLocations(l4, l2)
let bs3 = await cq.moved(b, [c31, c32, c41, c42])
let result = cq.val(bs3)
