// source: test_cadquery.py::TestCadQuery::testSolidReferencesCombine (var c)
// c = CQ(makeUnitCube()) — the 6-face unit cube itself (XY-centred Z 0..1).
import * as cq from '@faicad/faijs-cadquery'
let w0 = cq.Workplane('XY')
let c = await cq.box(w0, 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(c)
