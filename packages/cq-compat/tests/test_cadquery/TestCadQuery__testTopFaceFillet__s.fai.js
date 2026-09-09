// source: test_cadquery.py::TestCadQuery::testTopFaceFillet (var s)
// s = Workplane("XY").box(1, 1, 1).faces("+Z").edges().fillet(0.1)
// Upstream .edges() on a face-selected workplane picks THE SELECTED FACE's
// edges; cq-compat fillet resolves those directly from the pending face
// selection, so the explicit edges() step is folded into fillet here.
// ref (cadquery 2.8.0): Compound, vol 0.9917994088339042 (10 faces)
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let s = await cq.fillet(cq.faces(b, '+Z'), 0.1)
let result = cq.val(s)
