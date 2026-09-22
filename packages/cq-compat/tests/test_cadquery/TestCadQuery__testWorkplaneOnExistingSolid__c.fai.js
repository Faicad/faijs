// source: test_cadquery.py::TestCadQuery::testWorkplaneOnExistingSolid (var c)
// c = CQ(makeUnitCube()).faces(">Z").workplane().circle(0.25).circle(0.125)
//     .extrude(0.25) — 0.25-high annular boss on the cube top (10 faces).
import * as cq from '@faicad/cq-compat'
let w0 = cq.Workplane('XY')
let cube = await cq.box(w0, 1, 1, 1, { centered: [true, true, false] })
let topSel = cq.faces(cube, '>Z')
let faceWp = await cq.workplane(topSel)
let two = cq.circle(faceWp, 0.25)
let both = cq.circle(two, 0.125)
let c = await cq.extrude(both, 0.25)
let result = cq.val(c)
