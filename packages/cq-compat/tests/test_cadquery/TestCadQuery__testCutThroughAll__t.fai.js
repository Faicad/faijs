// source: test_cadquery.py::TestCadQuery::testCutThroughAll (var t, final)
// t = r + center Ø1 thru hole + side Ø0.25 thru hole along Y at CenterOfMass
import * as cq from '@faicad/cq-compat'
let p0 = await cq.extrude(cq.rect(cq.Workplane('XY'), 2.0, 2.0), 0.5)
let p1 = await cq.workplane(cq.faces(p0, '>Z'))
let p2 = cq.pushPoints(p1, [[0.65, 0.65], [0.65, -0.65], [-0.65, 0.65], [-0.65, -0.65]])
let r = await cq.cutThruAll(cq.circle(p2, 0.125))
let t1 = await cq.cutThruAll(cq.circle(r, 0.5))
let w = await cq.workplane(cq.faces(t1, '>Y'), { centerOption: 'CenterOfMass' })
let t = await cq.cutThruAll(cq.circle(w, 0.125))
let result = cq.val(t)
