// source: test_cadquery.py::TestCadQuery::testFrontReference (var r)
// r = CQ(makeUnitCube()).faces("front").workplane().circle(0.125).cutBlind(-2.0)
// makeUnitCube() == Workplane().rect(1,1).extrude(1) -> 1x1x1 with z in [0, 1]
// (NOT centred on z — that is why we build it from rect+extrude instead of box()).
// "front" is the +Z face: named views are aliases for an axis selector
// (cadquery/selectors.py:687-694) — front=>">Z", back=>"<Z", left=>"<X",
// right=>">X", top=>">Y", bottom=>"<Y".
// NOTE: this faces("front") workplane() path was broken until the phase2 pass:
// resolveFaceSelector had no named-view entry and silently fell back to the
// whole-shape bbox centre (z=0.5) instead of the face plane (z=1), which cost
// exactly half a hole in volume (0.0245 mm3).
import * as cq from '@faicad/cq-compat'
let cube = await cq.extrude(cq.rect(cq.Workplane('XY'), 1, 1), 1)
let front = await cq.faces(cube, 'front')
let wp1 = await cq.workplane(front)
let circ = await cq.circle(wp1, 0.125)
let r = await cq.cutBlind(circ, -2.0)
let result = cq.val(r)
