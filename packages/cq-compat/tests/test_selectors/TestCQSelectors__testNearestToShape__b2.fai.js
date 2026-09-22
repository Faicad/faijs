// source: test_selectors.py::TestCQSelectors::testNearestToShape (var b2)
// b1 = box(1,1,1) (free fn: XY-centred, Z 0..1); b2 = b1.moved(x=5);
// b3 = b1.moved(x=-15); res = (b2+b3).solids(selectors.NearestToShape(b1))
// → picks b2 (closest). Ref harness exports val() = the selected shape.
import * as cq from '@faicad/cq-compat'
let w0 = cq.Workplane('XY')
let b1 = await cq.box(w0, 1, 1, 1, { centered: [true, true, false] })
let b2 = await cq.moved(b1, { x: 5 })
let b3 = await cq.moved(b1, { x: -15 })
let result = cq.val(b2)
