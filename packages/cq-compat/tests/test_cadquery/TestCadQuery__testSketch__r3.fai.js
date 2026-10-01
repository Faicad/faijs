// source: test_cadquery.py::TestCadQuery::testSketch (var r3)
// r3 = Workplane().pushPoints((Location(Vector(1,1,0)),))
//        .sketch().circle(2).wires().offset(-0.1, "s").finalize().extrude(1)
// ref anchor: vol=1.22522113490, com (1,1,0.5), bbox x[-1,3] y[-1,3] z[0,1]
import * as cq from '@faicad/cq-compat'
let wp0 = await cq.pushPoints(cq.Workplane(), [[1, 1]])
let sk0 = cq.sketch(wp0)
let sk1 = cq.sketchCircle(sk0, 2)
let sk2 = cq.sketchWires(sk1)
let sk3 = cq.sketchOffset(sk2, -0.1, { mode: 's' })
let wp = cq.sketchFinish(sk3, wp0)
let r3 = await cq.extrude(wp, 1)
let result = cq.val(r3)
