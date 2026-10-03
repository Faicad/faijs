// source: test_cadquery.py::TestCadQuery::testCutEach (var w0, FINAL value)
// w = Workplane().box(3, 2, 2); c = Workplane().box(2, 2, 2).val()
// w0 = w.vertices().cutEach(lambda loc: c.located(loc))
//   -> all 8 corners cut away: a 1x2x2 box is left (vol 4)
// ref (out/ref/…testCutEach__w0.step): vol 4, bbox x[-0.5,0.5] y[-1,1] z[-1,1],
//   topo f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let w = await cq.box(cq.Workplane(), 3, 2, 2)
let c = await cq.box(cq.Workplane(), 2, 2, 2)
let wv = await cq.vertices(w)
let w0 = await cq.cutEach(wv, c)
let result = cq.val(w0)
