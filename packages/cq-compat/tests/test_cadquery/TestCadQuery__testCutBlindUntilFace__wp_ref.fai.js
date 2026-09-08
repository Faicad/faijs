// source: test_cadquery.py::TestCadQuery::testCutBlindUntilFace (var wp_ref)
// wp_ref = Workplane("XY").box(40,10,2).pushPoints([(-20,0,5),(0,0,5),(20,0,5)]).box(10,10,10)
// WORKAROUND: cq-compat pushPoints() is 2-D only, so the z=5 offset is realised
// with translate()+union(); the fused result is geometrically identical.
// (tracked as op:pushPoints.3d)
import * as cq from '@faicad/cq-compat'
let base = await cq.box(cq.Workplane('XY'), 40, 10, 2)
let b1 = await cq.box(cq.Workplane('XY'), 10, 10, 10)
let t1 = await cq.translate(b1, [-20, 0, 5])
let u1 = await cq.union(base, t1)
let b2 = await cq.box(cq.Workplane('XY'), 10, 10, 10)
let t2 = await cq.translate(b2, [0, 0, 5])
let u2 = await cq.union(u1, t2)
let b3 = await cq.box(cq.Workplane('XY'), 10, 10, 10)
let t3 = await cq.translate(b3, [20, 0, 5])
let wp_ref = await cq.union(u2, t3)
let result = cq.val(wp_ref)
