// source: test_free_functions.py::test_loft (var r6)
// r6 = loft(f1, f2) with
//   f1 = face(rect(2, 1), rect(0.5, 0.2).moved(x=0.5), rect(0.5, 0.2).moved(x=-0.5))
//   f2 = face(rect(3, 2), circle(0.5).moved(x=0.7), circle(0.5).moved(x=-0.7)).moved(z=1)
// Upstream lofts the two faces' OUTER wires into a capped solid, then lofts each
// inner-wire pair into its own capped solid and sews everything together
// (`solid(side, *sides, top, bot)` with `top -= compound(tops)`). Sewing the
// outer shell together with the inner shells is exactly a boolean difference of
// the capped solids, so the mirror builds outer − inner1 − inner2 with existing
// ops (verified on cadquery 2.8.0: r6 vol 3.047991271384902 / 16 faces vs
// decomposed equiv vol 3.0479912713849013 / 16 faces).
// ref (cadquery 2.8.0): 1 solid, 16 faces, vol 3.047991, bbox x +-1.5 y +-1 z 0..1
import * as cq from '@faicad/cq-compat'
// outer: rect(2, 1) @z=0 -> rect(3, 2) @z=1
let a0 = await cq.rect(cq.Workplane('XY'), 2, 1)
let pa1 = await cq.transformed(cq.Workplane('XY'), { offset: [0, 0, 1] })
let a1 = await cq.rect(pa1, 3, 2)
let outer = await cq.loft(a0, a1)
// inner 1: rect(0.5, 0.2) @x=+0.5,z=0 -> circle(0.5) @x=+0.7,z=1
let pb0 = await cq.transformed(cq.Workplane('XY'), { offset: [0.5, 0, 0] })
let b0 = await cq.rect(pb0, 0.5, 0.2)
let pb1 = await cq.transformed(cq.Workplane('XY'), { offset: [0.7, 0, 1] })
let b1 = await cq.circle(pb1, 0.5)
let inner1 = await cq.loft(b0, b1)
// inner 2: the x-mirrored pair
let pc0 = await cq.transformed(cq.Workplane('XY'), { offset: [-0.5, 0, 0] })
let c0 = await cq.rect(pc0, 0.5, 0.2)
let pc1 = await cq.transformed(cq.Workplane('XY'), { offset: [-0.7, 0, 1] })
let c1 = await cq.circle(pc1, 0.5)
let inner2 = await cq.loft(c0, c1)
let d1 = await cq.cut(outer, inner1)
let r6 = await cq.cut(d1, inner2)
let result = cq.val(r6)
