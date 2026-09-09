// source: test_cadquery.py::TestCadQuery::testRevolveCylinder (var result)
// ref (cadquery 2.8.0): vol 2356.194490, 5 faces, bbox [-15,-5,-10]..[5,5,10]
//
// NOTE: corresponds to the test's LAST `result` assignment:
//   Workplane("XY").rect(10,10).revolve(270.0, (-5,-5), (-5,5), False)
// Earlier assignments are overwritten upstream. The FIRST `.revolve()` default
// case (rect centered on the axis, 360 deg) crosses the revolve axis and is
// rejected by the vendored occt-wasm kernel (REVOLVE_FAILED) where full OCCT
// accepts it — documented in src/revolve.test.ts (KNOWN KERNEL LIMIT).
import * as cq from '@faicad/cq-compat'
let wp1 = cq.rect(cq.Workplane('XY'), 10, 10)
let wp2 = await cq.revolve(wp1, 270, [-5, -5], [-5, 5], false)
let result = cq.val(wp2)
