// source: test_shapes.py::test_bin_import_export (var b)
// b = box(1, 1, 1)  (free function, NOT centred: z spans [0,1])
// ref anchor: vol=1, bbox ±0.5 × z[0,1], topo f6/e12/v8/s1
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(b)
