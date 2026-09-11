// source: test_assembly.py::test_constrain (var b3)
// b3 = cq.Workplane().pushPoints([(0, 0), (-2, -5)]).box(1, 1, 3) — the
// workplane stack holds two centered 1x1x3 boxes; the harness exports the
// stack (compound, ref probe: vol 6, 12 faces, com (-1,-2.5,0)).
// compound() must be assigned directly to result (single-terminal rule).
import * as cq from '@faicad/cq-compat'
let bA = await cq.box(cq.Workplane('XY'), 1, 1, 3)
let bB = await cq.box(cq.Workplane('XY'), 1, 1, 3)
let bBt = await cq.translate(bB, [-2, -5, 0])
let b3 = cq.compound(cq.val(bA), cq.val(bBt))
let result = b3
