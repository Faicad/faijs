// source: test_selectors.py::TestCQSelectors::testShape (var res1)
// res1 = s.solids() — single-solid shape stays a Solid (no wrap).
// Same geometry as the base box(3, 2, 1).
// ref (cadquery 2.8.0): Solid, vol 6
import * as cq from '@faicad/cq-compat'
let w = await cq.box(cq.Workplane('XY'), 3, 2, 1)
let res1 = cq.val(w)
let result = res1
