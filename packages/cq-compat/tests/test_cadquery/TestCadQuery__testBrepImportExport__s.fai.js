// source: test_cadquery.py::TestCadQuery::testBrepImportExport (var s)
// s = Workplane().box(1, 1, 1).val()  (the export source; ref is the plain box)
// ref anchor: vol=1, bbox ±0.5, topo f6/e12/v8/s1
import * as cq from '@faicad/cq-compat'
let s = await cq.box(cq.Workplane(), 1, 1, 1)
let result = cq.val(s)
