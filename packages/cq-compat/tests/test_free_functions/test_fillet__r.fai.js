// source: test_free_functions.py::test_fillet (var r)
// r = fillet(b, b.edges(">Z"), 0.1) — b = box(1,1,1) base z=0
// ">Z" face of the box carries exactly the 4 top edges, so the faces(">Z")
// + fillet path reproduces the free-function fillet over edges(">Z").
// ref (cadquery 2.8.0): Solid, vol 0.9917994
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let r = await cq.fillet(cq.faces(b, '>Z'), 0.1)
let result = cq.val(r)
