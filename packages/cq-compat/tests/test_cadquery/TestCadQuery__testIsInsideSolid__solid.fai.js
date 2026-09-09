// source: test_cadquery.py::TestCadQuery::testIsInsideSolid (var solid — LAST assignment)
// solid = model.val() on the LAST model (box100 - box10); upstream val() is
// objects[0], so solid is the very same shape as `model`.
// ref (probed): vol 999000.000000, bbox [-50,50]^3, 12 faces.
import * as cq from '@faicad/cq-compat'
let voidBox = await cq.box(cq.Workplane('XY'), 10, 10, 10)
let outer = await cq.box(cq.Workplane('XY'), 100, 100, 100)
let model = await cq.cut(outer, voidBox)
// solid = model.val() -> objects[0]; cq.val() already returns objects[0].
let result = cq.val(model)
