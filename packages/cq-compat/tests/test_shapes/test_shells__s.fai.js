// source: test_shapes.py::test_shells (var s)
// s = box(2, 2, 2) - box(1, 1, 1).moved(z=0.5)
// ref (cadquery 2.8.0): Solid, vol 7 — free-function boxes are xy-centred and
// sit on z=0: outer z in [0,2], cavity z in [0.5,1.5], x/y in [-0.5,0.5].
import * as cq from '@faicad/cq-compat'
let outer = await cq.box(cq.Workplane(), 2, 2, 2, { centered: [true, true, false] })
let inner = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let cavity = cq.moved(inner, cq.Location([0, 0, 0.5]))
let s = await cq.cut(outer, cavity)
let result = cq.val(s)
