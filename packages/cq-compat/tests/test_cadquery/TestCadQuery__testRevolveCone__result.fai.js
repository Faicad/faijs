// source: test_cadquery.py::TestCadQuery::testRevolveCone (var result)
// result = Workplane("XY").lineTo(0, 10).lineTo(5, 0).close().revolve()
// ref (probed): vol 261.799388 (= pi*5^2*10/3), com y 2.5,
//               bbox x,z in [-5,5], y in [0,10], 2 faces / 2 edges / 2 vertices.
// Default revolve axis = local +Y (axisStart (0,0) -> axisEnd (0,1)).
// NOTE: unlike `rect(...).revolve()` this profile only TOUCHES the axis (the
// (0,0)-(0,10) edge lies on it) and the vendored kernel accepts it.
import * as cq from '@faicad/cq-compat'
let w1 = cq.lineTo(cq.Workplane('XY'), 0, 10)
let w2 = await cq.lineTo(w1, 5, 0)
let w3 = await cq.close(w2)
let cone = await cq.revolve(w3)
let result = cq.val(cone)
