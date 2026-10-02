// source: test_free_functions.py::test_prism (var box_shape)
// box_shape = box(1, 1, 1)  (free function fixture, NOT centred: z spans [0,1])
// ref anchor: vol=1, bbox ±0.5 × z[0,1], topo f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let box_shape = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(box_shape)
