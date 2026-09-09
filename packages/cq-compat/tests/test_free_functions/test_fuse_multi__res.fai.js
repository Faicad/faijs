// source: test_free_functions.py::test_fuse_multi (var res)
// res = fuse(b, b.moved(x=0.1), b.moved(x=0.2))  — b = box(1,1,1) base z=0
// Three overlapping boxes chained; fuse is associative here so the chained
// union yields the same solid (vol 1.2, one solid).
// ref (cadquery 2.8.0): Solid, vol 1.2
import * as cq from '@faicad/cq-compat'
let b0 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let b1 = await cq.translate(b0, [0.1, 0, 0])
let b2 = await cq.translate(b0, [0.2, 0, 0])
let u1 = await cq.union(b0, b1)
let res = await cq.union(u1, b2)
let result = cq.val(res)
