// source: test_free_functions.py::test_moved (var bs5)
// ref (cadquery 2.8.0): vol 2.000000, 12 faces, com (0,0,0.5)
//   bs5 = bs4.moved((1,0,0)).move((-1,0,0))  -> net identity, == bs4
//   (upstream `move` mutates in place; cq-compat carriers are immutable,
//    so move() is an alias of moved())
//
// NOTE: the two locations cancel, and cq-compat cannot transform an ALREADY
// transformed compound (a second applyMatrix on it aborts inside occt-wasm with
// "null function or function signature mismatch"), so the mirror folds them with
// composeLocations and applies the net location in a single moved() call.
//
import * as cq from '@faicad/cq-compat'
let wp0 = cq.Workplane('XY')
// func.box(1,1,1) is xy-centred and sits on z=0 (z 0..1) - cq.box is centred on
// the workplane origin, so lift it by half the height to match.
let b0 = await cq.box(wp0, 1, 1, 1)
let b = await cq.translate(b0, [0, 0, 0.5])
// func.sphere(d) takes the DIAMETER: sphere(0.1) -> radius 0.05 (vol 0.000524).
let sp = await cq.sphere(wp0, 0.05)
let bs4 = await cq.moved(b, [0, 0, 1], [0, 0, -1])
let lm1 = cq.Location([1, 0, 0])
let lm2 = cq.Location([-1, 0, 0])
let net = cq.composeLocations(lm2, lm1)
let bs5 = await cq.moved(bs4, net)
let result = cq.val(bs5)
