// source: test_cadquery.py::TestCadQuery::testWorkplaneFromFace (var r)
// r = CQ(makeUnitCube()).faces(">Z").workplane().circle(0.125).cutBlind(-2.0)
// makeUnitCube = 1x1x1 XY-centred Z 0..1; blind cut 2.0 through the top face
// → 7 faces (ref harness exports val()).
import * as cq from '@faicad/cq-compat'
let w0 = cq.Workplane('XY')
let cube = await cq.box(w0, 1, 1, 1, { centered: [true, true, false] })
let topSel = cq.faces(cube, '>Z')
let faceWp = await cq.workplane(topSel)
let r = await cq.cutBlind(cq.circle(faceWp, 0.125), -2.0)
let result = cq.val(r)
