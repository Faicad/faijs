// source: test_free_functions.py::test_hollow_open (var res1)
// res1 = hollow(box_shape, box_shape.faces(">Z"), -0.1)  — open top, walls inward.
// MakeThickSolidByJoin semantics: kernel shell(solid, [top], +|t|) — measured
// 0.424 on the unit box, exact match with upstream (kind irrelevant for
// inward offsets, which stay sharp).
// ref (probed): Solid, vol 0.424, 11 faces.
import * as cq from '@faicad/cq-compat'
let b0 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let f0 = await cq.faces(b0, '>Z')
let res1 = await cq.shell(f0, -0.1)
let result = cq.val(res1)
