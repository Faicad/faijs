// source: test_cadquery.py::TestCadQuery::testToSVG (var r)
// r = Workplane("XY").rect(5,5).extrude(5) — rect centered on origin, extrude
// up +Z (ref probe: x/y [-2.5,2.5], z [0,5], vol 125, 6 faces).
// The exported value is the solid; toSvg() string checks are not STEP-observable.
import * as cq from '@faicad/cq-compat'
let r = await cq.box(cq.Workplane('XY'), 5, 5, 5, { centered: [true, true, false] })
let result = cq.val(r)
