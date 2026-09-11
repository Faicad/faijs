// source: tests.test_cadquery.py::TestCadQuery::testSplitKeepingHalf (var result)
// c = CQ(makeUnitCube()).faces(">Z").workplane().circle(0.25).cutThruAll()
// result = c.faces(">Y").workplane(-0.5).split(keepTop=True)
//
// Same cube/hole/splitter as testSplitKeepingBottom, but keepTop keeps the
// +normal side (y>0). makeUnitCube = 1×1×1 with XY centred, Z spanning [0,1].
// ref (probed): z∈[0,1], y∈[0,0.5].
import * as cq from '@faicad/cq-compat'

let w0 = cq.Workplane('XY')
let cube = await cq.box(w0, 1, 1, 1, { centered: [true, true, false] })
let topSel = cq.faces(cube, '>Z')
let faceWp = await cq.workplane(topSel)
let holed = await cq.cutThruAll(cq.circle(faceWp, 0.25))
let kept = await cq.splitFace(holed, { origin: [0, 0, 0], normal: [0, 1, 0] }, 'top')
let result = cq.val(kept)
