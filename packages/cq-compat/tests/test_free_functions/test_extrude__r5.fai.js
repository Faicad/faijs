// source: test_free_functions.py::test_extrude (var r5)
// r5 = extrude(f, (0, 0, 1), both=True)  — f = fill(rect(1,1)) at z=0
// both=True extrudes the face symmetrically: z in [-1, 1], vol 2.
// Built as two unit extrusions (up from z=0, up from z=-1) fused — the union
// is the same solid.
// ref (cadquery 2.8.0): Solid, vol 2
import * as cq from '@faicad/cq-compat'
let wUp = await cq.rect(cq.Workplane('XY'), 1, 1)
let up = await cq.extrude(wUp, 1)
// Upstream both=True: prism(el.moved(-d), 2d) -> the face is shifted by -d and
// extruded 2d, i.e. the up prism plus a copy shifted down one step, fused.
let down = await cq.translate(up, [0, 0, -1])
let r5 = await cq.union(up, down)
let result = cq.val(r5)
