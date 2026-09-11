// source: tests.test_cadquery.py::TestCadQuery::testSplitKeepingBoth (var result)
// c = CQ(makeUnitCube()).faces(">Z").workplane().circle(0.25).cutThruAll()
// result = c.faces(">Y").workplane(-0.5).split(keepTop=True, keepBottom=True)
//
// Upstream stacks BOTH halves ([top, bottom]), but the ref harness exports
// `val()` = objects[0] only (see tests/README.md "多体用例约定"), i.e. the TOP
// half. So the mirror reproduces objects[0] (keepTop) to stay aligned with the
// ref STEP — its geometry equals testSplitKeepingHalf__result by construction.
// makeUnitCube = 1×1×1 with XY centred, Z spanning [0,1].
import * as cq from '@faicad/cq-compat'

let w0 = cq.Workplane('XY')
let cube = await cq.box(w0, 1, 1, 1, { centered: [true, true, false] })
let topSel = cq.faces(cube, '>Z')
let faceWp = await cq.workplane(topSel)
let holed = await cq.cutThruAll(cq.circle(faceWp, 0.25))
let kept = await cq.splitFace(holed, { origin: [0, 0, 0], normal: [0, 1, 0] }, 'top')
let result = cq.val(kept)
