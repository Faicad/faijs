// source: test_cadquery.py::TestCadQuery::testTaperedExtrudeHeight (var s)
// s = Workplane("XY").rect(100.0, 100.0).extrude(100.0, taper=20.0)
// Tapered prism, positive taper narrows. ref zlen == 100.
import * as cq from '@faicad/cq-compat'
let w0 = await cq.rect(cq.Workplane('XY'), 100.0, 100.0)
let s = await cq.extrude(w0, 100.0, true, { taper: 20.0 })
let result = cq.val(s)
