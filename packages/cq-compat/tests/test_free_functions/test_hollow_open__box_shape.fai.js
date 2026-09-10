// source: test_free_functions.py::test_hollow_open (var box_shape)
// box_shape = box(1, 1, 1)  — fixture, centered x/y, z from 0.
// ref (probed): Solid, vol 1.
import * as cq from '@faicad/cq-compat'
let box_shape = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(box_shape)
