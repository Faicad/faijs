// source: test_cadquery.py::TestCadQuery::testIsInsideSolid (var model — LAST assignment)
// model is re-assigned three times; the harness exports the final one:
//   model = Workplane("XY").box(100, 100, 100).cut(void)
// ref (probed): vol 999000.000000 (= 100^3 - 10^3), bbox [-50,50]^3, 12 faces.
import * as cq from '@faicad/cq-compat'
let voidBox = await cq.box(cq.Workplane('XY'), 10, 10, 10)
let outer = await cq.box(cq.Workplane('XY'), 100, 100, 100)
let model = await cq.cut(outer, voidBox)
let result = cq.val(model)
