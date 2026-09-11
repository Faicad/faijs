// source: test_selectors.py::TestCQSelectors::testNthDistance (var c)
// c = Workplane("XY").box(1,4,1,centered=(False,True,False))
//     .faces("<Z").box(2,2,2,centered=(True,True,False))
//     .faces(">Z").box(1,1,1,centered=(True,True,False))
// The selector/Nth assertions in the case are not STEP-observable; the harness
// exports the final solid c (vol 11, com (0.5,0,1.045455), 19 faces — live
// cadquery probe). Each .faces(sel).box(centered=(True,True,False)) call puts
// the box on the selected face plane, centered x/y on the face center:
// base x[0,1] y±2 z[0,1]; mid on the <Z face plane (center (0.5,0,0)) ->
// x[-0.5,1.5] y±1 z[0,2]; top on the >Z face plane (center (0.5,0,2)) ->
// x[0,1] y±0.5 z[2,3].
import * as cq from '@faicad/cq-compat'
let base = await cq.box(cq.Workplane('XY'), 1, 4, 1, { centered: [false, true, false] })
let mid0 = await cq.box(cq.Workplane('XY'), 2, 2, 2, { centered: [true, true, false] })
let mid = await cq.translate(mid0, [0.5, 0, 0])
let s2 = await cq.union(base, mid)
let topBox0 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let topBox = await cq.translate(topBox0, [0.5, 0, 2])
let c = await cq.union(s2, topBox)
let result = cq.val(c)
