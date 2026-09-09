// source: test_free_functions.py::test_chamfer (var r)
// r = chamfer(b, b.edges(">Z"), 0.1) — b = box(1,1,1) base z=0
// ">Z" face of the box carries exactly the 4 top edges, so the faces(">Z")
// + chamfer path reproduces the free-function chamfer over edges(">Z").
// ref (cadquery 2.8.0): Solid, vol 0.9813333
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let r = await cq.chamfer(cq.faces(b, '>Z'), 0.1)
let result = cq.val(r)
