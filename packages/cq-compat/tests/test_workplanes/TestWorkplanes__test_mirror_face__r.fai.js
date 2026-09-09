// source: test_workplanes.py::TestWorkplanes::test_mirror_face (var r)
// r = Workplane("XY").line(0, 1).line(1, -1).close().extrude(1)
// r = r.mirror(r.faces().objects[1], union=True)
// ref (probed): vol 1.000000, com (0.5, 0.5, 0.5), bbox [0,1]^3, 6 faces.
//
// faces().objects[1] is the prism's slanted side face: it spans (0,1)-(1,0),
// so its normal is (1,1,0)/sqrt(2) and it passes through (0.5, 0.5, z).
// cq-compat has no face-by-index access, so the mirror is written in the
// equivalent vector form mirror(shape, normal, basePoint, union=True).
// Mirroring the triangle across that plane yields (1,1),(1,0),(0,1) — union
// with the original fills the unit square (vol 0.5 + 0.5 = 1).
import * as cq from '@faicad/cq-compat'
let w1 = cq.line(cq.Workplane('XY'), 0, 1)
let w2 = await cq.line(w1, 1, -1)
let w3 = await cq.close(w2)
let prism = await cq.extrude(w3, 1)
let S = 0.7071067811865476
let r = await cq.mirror(prism, [S, S, 0], [0.5, 0.5, 0.5], true)
let result = cq.val(r)
