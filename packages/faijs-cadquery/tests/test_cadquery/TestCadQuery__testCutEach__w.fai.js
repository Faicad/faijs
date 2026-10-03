// source: test_cadquery.py::TestCadQuery::testCutEach (var w)
// w = Workplane().box(3, 2, 2)
// ref (out/ref/…testCutEach__w.step): vol 12, bbox x[-1.5,1.5] y[-1,1] z[-1,1],
//   topo f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let w = await cq.box(cq.Workplane(), 3, 2, 2)
let result = cq.val(w)
