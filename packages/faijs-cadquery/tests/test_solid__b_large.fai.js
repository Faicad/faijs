// source: test_free_functions.py::test_solid (var b_large)
// b_large = box(10, 10, 1)  (free function, NOT centred: z spans [0,1])
// ref anchor: vol=100, bbox ±5 × z[0,1], topo f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let b_large = await cq.box(cq.Workplane(), 10, 10, 1, { centered: [true, true, false] })
let result = cq.val(b_large)
