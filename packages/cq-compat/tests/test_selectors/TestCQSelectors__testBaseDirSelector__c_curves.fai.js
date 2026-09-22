// source: test_selectors.py::TestCQSelectors::testBaseDirSelector (var c_curves)
// c_curves = Workplane().sphere(1) — sphere edges/faces filter assertions in-process; exports sphere (vol 4.18879).
import * as cq from '@faicad/cq-compat'
let c_curves = await cq.sphere(cq.Workplane(), 1)
let result = cq.val(c_curves)
