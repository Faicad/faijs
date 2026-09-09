// source: test_free_functions.py::test_moved (var s)
// ref (cadquery 2.8.0): vol 0.000524, 1 faces, com (0,0,1)
//   s = sphere(0.1)  -- then, at the very end of the test,
//   s.move(b.faces('>Z')) moves it in place to z = 1.
// NOTE: the ref STEP records the variable's FINAL state, so the mirror
// applies that trailing move directly.
//
import * as cq from '@faicad/cq-compat'
let wp0 = cq.Workplane('XY')
// func.box(1,1,1) is xy-centred and sits on z=0 (z 0..1) - cq.box is centred on
// the workplane origin, so lift it by half the height to match.
let b0 = await cq.box(wp0, 1, 1, 1)
let b = await cq.translate(b0, [0, 0, 0.5])
// func.sphere(d) takes the DIAMETER: sphere(0.1) -> radius 0.05 (vol 0.000524).
let sp = await cq.sphere(wp0, 0.05)
let s = await cq.moved(sp, cq.Location([0, 0, 1]))
let result = cq.val(s)
