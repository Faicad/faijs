// source: tests.test_cadquery.py::TestCadQuery::testSplitKeepingBottom (var result)
// c = CQ(makeUnitCube()).faces(">Z").workplane().circle(0.25).cutThruAll()
// result = c.faces(">Y").workplane(-0.5).split(keepTop=False, keepBottom=True)
//
// makeUnitCube() = makeCube(1.0, xycentered=True): 1×1×1 with XY centred on the
// origin but Z spanning [0, 1] (Z is NOT centred — the upstream helper's second
// arg is `xycentered`). Hole: r=0.25 cylinder through Z.
// Splitter plane: workplane on the >Y face (y=0.5) offset -0.5 along its +Y
// normal -> the y=0 (XZ) plane with normal +Y. keepBottom keeps the -normal
// side (y<0), i.e. the half-cube minus half the hole (8 faces).
// ref (probed): z∈[0,1], y∈[-0.5,0], vol 0.401825222...
import * as cq from '@faicad/cq-compat'

let w0 = cq.Workplane('XY')
let cube = await cq.box(w0, 1, 1, 1, { centered: [true, true, false] })
let topSel = cq.faces(cube, '>Z')
let faceWp = await cq.workplane(topSel)
let holed = await cq.cutThruAll(cq.circle(faceWp, 0.25))
let kept = await cq.splitFace(holed, { origin: [0, 0, 0], normal: [0, 1, 0] }, 'bottom')
let result = cq.val(kept)
