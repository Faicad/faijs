// source: test_cadquery.py::TestCadQuery::testGlue (var res — LAST assignment)
// The harness snapshots locals at function exit, and upstream re-assigns res
// twice; only the final one is exported:
//   res = box1.union(box2, glue=True)          <- overwritten
//   res = obj.union(box2, glue=True)           <- exported
// ref (probed): vol 5.000000, com (0, 1, 0.9), bbox y in [-0.5, 2.5], z in [0,2],
// 10 faces. glue=True only affects face merging, not geometry — cq-compat has
// no glue mode, plain union reproduces the same solid.
import * as cq from '@faicad/cq-compat'
let w1 = cq.rect(cq.Workplane('XY'), 1, 1)
let w2 = await cq.extrude(w1, 2)
let w3 = await cq.moveTo(w2, 0, 2)
let w4 = cq.rect(w3, 1, 1)
let obj = await cq.extrude(w4, 2)
let p = await cq.translate(cq.Workplane('XY'), [0, 1, 0])
let q1 = cq.rect(p, 1, 1)
let box2 = await cq.extrude(q1, 1)
let res = await cq.union(obj, box2)
let result = cq.val(res)
