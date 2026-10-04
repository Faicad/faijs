// source: test_free_functions.py::test_imprint (var res_glue_partial)
// res_glue_partial = imprint(b1, b3, glue="partial") — b3 (0.5 box) partially
// touches b1's face. BOPAlgo_Builder splits b1's face at b3's boundary and
// merges the shared face: CadQuery reports 12 faces, vol 1.125, 2 solids.
// ref (cadquery 2.8.0): Compound, vol 1.125, f12/s2
import * as cq from '@faicad/faijs-cadquery'
let b1 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let b3 = await cq.box(cq.Workplane(), 0.5, 0.5, 0.5, { centered: [true, true, false] })
let b3m = await cq.translate(b3, [0.75, 0, 0])
let result = cq.imprint(b1, b3m)