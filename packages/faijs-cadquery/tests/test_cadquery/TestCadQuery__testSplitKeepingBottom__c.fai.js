// source: tests.test_cadquery.py::TestCadQuery::testSplitKeepingBoth (var c)
// c = CQ(makeUnitCube()).faces(">Z").workplane().circle(0.25).cutThruAll()
// makeUnitCube = 1x1x1 XY-centred, Z spanning [0,1]; the through-all hole
// yields 7 faces (ref harness exports val() = the holed cube).
import * as cq from '@faicad/faijs-cadquery'

let w0 = cq.Workplane('XY')
let cube = await cq.box(w0, 1, 1, 1, { centered: [true, true, false] })
let topSel = cq.faces(cube, '>Z')
let faceWp = await cq.workplane(topSel)
let c = await cq.cutThruAll(cq.circle(faceWp, 0.25))
let result = cq.val(c)
