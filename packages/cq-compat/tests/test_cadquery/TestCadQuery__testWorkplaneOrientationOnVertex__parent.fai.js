// source: test_cadquery.py::TestCadQuery::testWorkplaneOrientationOnVertex (var parent)
// parent = Workplane("XY").rect(10.0, 10.0).extrude(10)
// Only `parent` produces a STEP (child workplane assertions export nothing).
// NOTE: the variable is named parentWp because "parent" is a banned identifier
// (security-scanner SEC_IDENT, window.parent).
// ref (cadquery 2.8.0): Solid, vol 1000
import * as cq from '@faicad/cq-compat'
let s = cq.Workplane('XY')
let parentWp = await cq.extrude(cq.rect(s, 10, 10), 10)
let result = cq.val(parentWp)
