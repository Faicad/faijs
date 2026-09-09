// source: test_free_functions.py::test_operators (var b2)
// b2 = box(2, 2, 2).moved(Location(-1, -1, -1))
//   free-function box: x/y centred, z in [0,2]; moved -> x,y in [-2,0], z in [-1,1]
// ref (cadquery 2.8.0): Solid, vol 8
import * as cq from '@faicad/cq-compat'
let b0 = await cq.box(cq.Workplane(), 2, 2, 2, { centered: [true, true, false] })
let b2 = await cq.translate(b0, [-1, -1, -1])
let result = cq.val(b2)
