// source: test_cadquery.py::TestCadQuery::testSketch (var r4)
// s = Sketch().trapezoid(3, 1, 120)
// r4 = Workplane().placeSketch(s, s.moved(Location(0, 0, 3))).loft()
// ref anchor: vol=10.7320508076, bbox x±2.07735036919, bbox z[0,3]
import * as cq from '@faicad/faijs-cadquery'
let s = cq.sketchTrapezoid(cq.sketchCreate(), 3, 1, 120)
let topSk = cq.sketchMoved(s, 0, 0, 0, 3)
let wp = cq.placeSketch(cq.Workplane(), s, topSk)
let r4 = await cq.loft(wp)
let result = cq.val(r4)
