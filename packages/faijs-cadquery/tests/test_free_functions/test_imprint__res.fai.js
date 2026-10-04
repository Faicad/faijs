// source: test_free_functions.py::test_imprint (var res)
// res = imprint(b1, b2) — two face-touching unit boxes, BOPAlgo_Builder
// merges the shared face: CadQuery reports 11 faces, vol 2, 2 solids.
// ref (cadquery 2.8.0): Compound, vol 2, f11/s2
import * as cq from '@faicad/faijs-cadquery'
let b1 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let b2 = await cq.translate(b1, [1, 0, 0])
let result = cq.imprint(b1, b2)