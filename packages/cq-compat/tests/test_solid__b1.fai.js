// source: test_free_functions.py::test_solid (var b1)
// b1 = box(0.1, 0.1, 0.1)  (free function, NOT centred: z spans [0,0.1])
// ref anchor: vol=0.001, bbox ±0.05 × z[0,0.1], topo f6/e12/v8/s1
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane(), 0.1, 0.1, 0.1, { centered: [true, true, false] })
let result = cq.val(b1)
