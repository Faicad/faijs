// source: test_free_functions.py::test_imprint (var res_glue_full)
// res_glue_full = imprint(b1, b2, glue="full") — same as res (glue strategy
// doesn't change the geometric result for these inputs).
// ref (cadquery 2.8.0): Compound, vol 2, f11/s2
import * as cq from '@faicad/faijs-cadquery'
let b1 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let b2 = await cq.translate(b1, [1, 0, 0])
let result = cq.imprint(b1, b2)