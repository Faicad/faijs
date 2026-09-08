// source: test_cadquery.py::TestCadQuery::testFrontReference (var r)
// r = CQ(makeUnitCube()).faces("front").workplane().circle(0.125).cutBlind(-2.0)
// makeUnitCube() == Workplane().rect(1,1).extrude(1) -> 1x1x1 with z in [0, 1]
// (NOT centred on z — that is why we build it from rect+extrude instead of box()).
// "front" is the -Y face (named-plane table fixed in the P3 parity pass).
import * as cq from '@faicad/cq-compat'
let cube = await cq.extrude(cq.rect(cq.Workplane('XY'), 1, 1), 1)
let front = await cq.faces(cube, 'front')
let wp1 = await cq.workplane(front)
let circ = await cq.circle(wp1, 0.125)
let r = await cq.cutBlind(circ, -2.0)
let result = cq.val(r)
