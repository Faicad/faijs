// source: test_free_functions.py::test_operators (var b3)
// b1 = box(1,1,1).moved(Location(-0.5,-0.5,-0.5))  — the free-function box
// occupies x,y in [-0.5,0.5], z in [0,1], so b1 is x,y in [-1,0],
// z in [-0.5,0.5].
// b3 = b1.moved(Location(0, 0, 1e-4))              (almost b1)
// ref (cadquery 2.8.0): Solid, vol 1
import * as cq from '@faicad/cq-compat'
let wp0 = cq.Workplane('XY')
let b0 = await cq.box(wp0, 1, 1, 1)
let boxFree = await cq.translate(b0, [0, 0, 0.5])
let b1 = await cq.translate(boxFree, [-0.5, -0.5, -0.5])
let b3 = await cq.translate(b1, [0, 0, 1e-4])
let result = cq.val(b3)
