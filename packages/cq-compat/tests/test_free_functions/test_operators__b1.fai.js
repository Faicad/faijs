// source: test_free_functions.py::test_operators (var b1)
// b1 = box(1, 1, 1).moved(Location(-0.5, -0.5, -0.5))
//   free-function box: x/y centred, z in [0,1]; moved -> x,y in [-1,0], z in [-0.5,0.5]
// ref (cadquery 2.8.0): Solid, vol 1
import * as cq from '@faicad/cq-compat'
let b0 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let b1 = await cq.translate(b0, [-0.5, -0.5, -0.5])
let result = cq.val(b1)
