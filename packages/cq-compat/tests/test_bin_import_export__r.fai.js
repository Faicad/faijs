// source: test_shapes.py::test_bin_import_export (var r)
// r = Shape.importBin(bio)  (round-trips b; ref is the same box)
// ref anchor: vol=1, bbox ±0.5 × z[0,1], topo f6/e12/v8/s1
import * as cq from '@faicad/cq-compat'
let r = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(r)
