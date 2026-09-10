// source: test_cadquery.py::TestCadQuery::testClosedShell (var s4_shape)
// s4_shape = Workplane("XY").box(2, 2, 2).val()  — the raw solid, no hollow.
// ref (probed): vol 8.0.
import * as cq from '@faicad/cq-compat'
let s4_shape = await cq.box(cq.Workplane('XY'), 2, 2, 2)
let result = cq.val(s4_shape)
