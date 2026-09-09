// source: test_workplanes.py::TestWorkplanes::test_mirror_workplane (var b2)
// b2 = Workplane().box(1,1,1)
// b2 = b2.mirror(b2.faces(">Z"), union=True)   -> vol 2
// b2 = b2.mirror(b2.faces(">Y"), union=True)   -> vol 4
// b2 = b2.mirror(b2.faces(">X"), union=True)   -> vol 8
// ref (cadquery 2.8.0): Compound, vol 8 — face-form mirror (normal + center of
// the selected face) with union.
import * as cq from '@faicad/cq-compat'
let b2 = await cq.box(cq.Workplane(), 1, 1, 1)
let fz = cq.faces(b2, '>Z')
b2 = await cq.mirror(b2, fz, null, true)
let fy = cq.faces(b2, '>Y')
b2 = await cq.mirror(b2, fy, null, true)
let fx = cq.faces(b2, '>X')
b2 = await cq.mirror(b2, fx, null, true)
let result = cq.val(b2)
