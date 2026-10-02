// source: test_cadquery.py::TestCadQuery::testTwistExtrudeCombineCut (var box)
// box = Workplane().box(10, 10, 10)  -> centred 10x10x10 box, vol 1000.
// (The `cut` var uses twistExtrude+combine="cut" which triggers the documented
//  kernel:boolean-near-coincident-bspline gap; only the base box is mirrored.)
import * as cq from '@faicad/faijs-cadquery'
let box = await cq.box(cq.Workplane(), 10, 10, 10)
let result = cq.val(box)
