// source: test_cadquery.py::TestCadQuery::test_loft_face (var w2)
// c = compound(f1, f2); w2 = Workplane().add(c).loft()
// Same geometry as w1: the compound path feeds both faces to the loft as
// sections (upstream asserts w1 and w2 are both a single solid; the ref STEP
// is byte-comparable in geometry — vol 1.980742, 5 BSPLINE + 2 PLANE caps).
// Mirror note: a bare `let c = cq.compound(...)` registers a second geometric
// terminal and the CLI would split the export into two STEP files, which the
// comparator cannot pair up. The two faces are therefore passed to `loft`
// directly (upstream free-function varargs form), which is geometry-identical.
import * as cq from '@faicad/cq-compat'
let w1r = await cq.rect(cq.Workplane('XY'), 1, 1)
let f1 = await cq.face(w1r)
let w2c = await cq.circle(cq.Workplane('XY'), 1)
let f2b = await cq.face(w2c)
let f2 = await cq.moved(f2b, cq.Location(0, 0, 1))
let w2 = await cq.loft(f1, f2)
let result = cq.val(w2)
