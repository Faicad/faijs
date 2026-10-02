// source: test_cadquery.py::TestCadQuery::testSolidReferencesCombine (var r)
// r = c.faces(">Z").workplane().circle(0.125).extrude(0.5, True) — a 0.5-high
// boss on the cube top, fused with the cube (8 faces total).
import * as cq from '@faicad/faijs-cadquery'
let w0 = cq.Workplane('XY')
let cube = await cq.box(w0, 1, 1, 1, { centered: [true, true, false] })
let topSel = cq.faces(cube, '>Z')
let faceWp = await cq.workplane(topSel)
let r = await cq.extrude(cq.circle(faceWp, 0.125), 0.5, true)
let result = cq.val(r)
