// source: test_selectors.py::TestCQSelectors::testShape (var res4)
// res4 = s.edges(">Z") where s = box(3, 2, 1) centered.
// DirectionMinMaxSelector orders edges by center-of-mass z: top edges sit at
// z=+0.5, bottom at -0.5, vertical edges at 0 — so exactly the 4 TOP edges.
// ref (cadquery 2.8.0): Compound (4 edges), bbox z=[0.5, 0.5]
import * as cq from '@faicad/cq-compat'
let w = await cq.box(cq.Workplane('XY'), 3, 2, 1)
let res4 = await cq.edgeCompound(w, '>Z')
let result = cq.val(res4)
