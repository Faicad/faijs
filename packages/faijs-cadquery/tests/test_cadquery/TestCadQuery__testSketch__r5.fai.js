// source: test_cadquery.py::TestCadQuery::testSketch (var r5)
// r5 = Workplane().sketch().polygon([(0,0),(0,1),(1,0)]).finalize().extrude(1)
// ref anchor: vol=0.5, bbox [0,1]² × z[0,1], com (1/3,1/3,1/2)
import * as cq from '@faicad/faijs-cadquery'
let sk = cq.sketch(cq.Workplane())
let sk1 = cq.sketchPolygon(sk, [[0, 0], [0, 1], [1, 0]])
let wp = cq.sketchFinish(sk1, cq.Workplane())
let r5 = await cq.extrude(wp, 1)
let result = cq.val(r5)
