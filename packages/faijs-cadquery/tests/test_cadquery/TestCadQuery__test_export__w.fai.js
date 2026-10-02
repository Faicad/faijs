// source: test_cadquery.py::TestCadQuery::test_export (var w)
// w = Workplane().box(1, 1, 1).export("box.brep")  (centred box)
// ref anchor: vol=1, bbox ±0.5, topo f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let w = await cq.box(cq.Workplane(), 1, 1, 1)
let result = cq.val(w)
