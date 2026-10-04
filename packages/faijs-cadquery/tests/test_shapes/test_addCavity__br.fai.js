// source: test_shapes.py::test_addCavity (var br)
// br = box(2,2,2).addCavity(box(1,1,1).moved(z=0.5)) — an internal void
// (upstream asserts 12 faces / 2 shells). faijs implements addCavity with the
// equivalent boolean cut (outer - cavity): the cavity bbox is strictly inside
// the outer bbox, and the cut yields exactly the upstream topology.
// ref: vol 7, f12/e24/v16/s1, bb x[-1,1] y[-1,1] z[0,2]
import * as cq from '@faicad/faijs-cadquery'
let b1 = await cq.box(cq.Workplane(), 2, 2, 2, { centered: [true, true, false] })
let cav0 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let cav = await cq.translate(cav0, [0, 0, 0.5])
let br = await cq.addCavity(b1, cav)
let result = cq.val(br)
