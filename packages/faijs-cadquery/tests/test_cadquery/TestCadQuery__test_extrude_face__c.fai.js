// source: test_cadquery.py::TestCadQuery::test_extrude_face (var c)
// f = face(rect(1,1)); c = compound(f) — the 1x1 planar face wrapped in a
// compound (ref harness exports val()).
import * as cq from '@faicad/faijs-cadquery'
let w0 = cq.Workplane('XY')
let f = await cq.face(cq.rect(w0, 1, 1))
let result = cq.compound(cq.val(f))
