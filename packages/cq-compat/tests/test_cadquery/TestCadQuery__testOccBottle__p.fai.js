// source: test_cadquery.py::TestCadQuery::testOccBottle (var p, final state)
// L=20, w=6, t=3
// p = Workplane(Plane.XY()).center(-L/2, 0).vLine(w/2)
//       .threePointArc((L/2, w/2 + t), (L, w/2)).vLine(-w/2).mirrorX().extrude(30.0, True)
// GOTCHA: `extrude(30.0, True)` — the 2nd positional arg is COMBINE, not
// centered, so the body runs z ∈ [0, 30] (ref bbox confirms z[0,30]).
// The later `p.faces(">Z").workplane().circle(3.0).extrude(2.0, True)` and
// `p.faces(">Z").shell(0.3)` statements are DISCARDED upstream (Workplane is
// immutable and their results are never bound), so `p` is the plain extrusion.
// ref (probed): vol 6042.66058397, bbox x[-10,10] y[-6,6] z[0,30], f6/e12/v8.
import * as cq from '@faicad/cq-compat'
let s = cq.Workplane('XY')
let c = cq.center(s, -10, 0)
let e1 = await cq.vLine(c, 3)
let e2 = await cq.threePointArc(e1, [10, 6], [20, 3])
let e3 = await cq.vLine(e2, -3)
let m = await cq.mirrorX(e3)
let p = await cq.extrude(m, 30)
let result = cq.val(p)
