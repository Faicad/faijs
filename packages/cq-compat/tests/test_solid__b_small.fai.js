// source: test_free_functions.py::test_solid (var b_small)
// b_small = box(0.1, 0.1, 0.1).moved(b_large)  -> shifted by b_large centre (0,0,0.5)
// ref anchor: vol=0.001, bbox ±0.05 × z[0.5,0.6], topo f6/e12/v8/s1
import * as cq from '@faicad/cq-compat'
let moved = await cq.translate(cq.Workplane(), [0, 0, 0.5])
let b_small = await cq.box(moved, 0.1, 0.1, 0.1, { centered: [true, true, false] })
let result = cq.val(b_small)
