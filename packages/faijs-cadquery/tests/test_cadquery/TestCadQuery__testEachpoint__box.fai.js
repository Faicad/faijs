// source: test_cadquery.py::TestCadQuery::testEachpoint (var box)
// box = Workplane().box(2, 2, 2)  (eachpoint target base; saved ref is the plain box)
// ref anchor: vol=8, bbox ±1, topo f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let box = await cq.box(cq.Workplane(), 2, 2, 2)
let result = cq.val(box)
