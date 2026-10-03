// source: test_cadquery.py::TestCadQuery::testCutEach (var c)
// c = Workplane().box(2, 2, 2).val()   (the cutter)
// ref (out/ref/…testCutEach__c.step): vol 8, bbox x[-1,1] y[-1,1] z[-1,1],
//   topo f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let c = await cq.box(cq.Workplane(), 2, 2, 2)
let result = cq.val(c)
