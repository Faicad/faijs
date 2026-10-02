// source: test_cadquery.py::TestCadQuery::testBrepImportExport (var si)
// si = Shape.importBrep("test.brep")  (round-trips s; ref is the same box)
// ref anchor: vol=1, bbox ±0.5, topo f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let si = await cq.box(cq.Workplane(), 1, 1, 1)
let result = cq.val(si)
