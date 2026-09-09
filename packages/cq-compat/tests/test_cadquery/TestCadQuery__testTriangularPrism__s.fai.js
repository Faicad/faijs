// source: test_cadquery.py::TestCadQuery::testTriangularPrism (var s)
// s = Workplane("XY").lineTo(1, 0).lineTo(1, 1).close().extrude(0.2)
// ref (probed): vol 0.100000, com (0.666667, 0.333333, 0.100000), 5 faces
// phase H: drafted wire (lineTo -> close) consumed by extrude.
import * as cq from '@faicad/cq-compat'
let w1 = cq.lineTo(cq.Workplane('XY'), 1, 0)
let w2 = await cq.lineTo(w1, 1, 1)
let w3 = await cq.close(w2)
let s = await cq.extrude(w3, 0.2)
let result = cq.val(s)
