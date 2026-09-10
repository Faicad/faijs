// source: test_cadquery.py::TestCadQuery::test_loft_face (var w1)
// f1 = plane(1, 1); f2 = face(circle(1)).moved(z=1)
// w1 = Workplane().add(f1).add(f2).loft()
// Loft between a 1x1 square face (z=0) and a r=1 disc face (z=1). Upstream
// `add` pushes both objects on the stack, so the two faces are the sections.
// ref (cadquery 2.8.0): Solid vol 1.980742, 5 BSPLINE side faces + 2 caps
//   (PLANE 1.0 + PLANE pi)
import * as cq from '@faicad/cq-compat'
let w1r = await cq.rect(cq.Workplane('XY'), 1, 1)
let f1 = await cq.face(w1r)
let w2c = await cq.circle(cq.Workplane('XY'), 1)
let f2b = await cq.face(w2c)
let f2 = await cq.moved(f2b, cq.Location(0, 0, 1))
let w1 = await cq.loft(f1, f2)
let result = cq.val(w1)
