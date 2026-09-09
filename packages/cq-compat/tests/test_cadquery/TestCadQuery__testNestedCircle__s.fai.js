// source: test_cadquery.py::TestCadQuery::testNestedCircle (var s)
// s = Workplane("XY").box(40,40,5).pushPoints([(10,0),(0,10)]).circle(4).circle(2).extrude(4)
// ref (cadquery 2.8.0): single solid, vol 8113.097335529232, faces 14
//   = box 8000 + 2 annuli (pi*(4^2-2^2)*4 = 150.796) - 2 * overlap (pi*12*2.5)
//
// NOTE: written multi-statement on purpose. Nesting two cq.circle() calls inside
// one argument list loses the OUTER radius (pendingWires records radius=undefined),
// leaving the plain base box (vol 8000). See docs/plans/2026-09-08-cq-compat-parity-phase2.md §7.8.
import * as cq from '@faicad/cq-compat'
let base = await cq.box(cq.Workplane('XY'), 40, 40, 5)
let p = cq.pushPoints(base, [[10, 0], [0, 10]])
let c1 = cq.circle(p, 4)
let c2 = cq.circle(c1, 2)
let s = await cq.extrude(c2, 4)
let result = cq.val(s)
