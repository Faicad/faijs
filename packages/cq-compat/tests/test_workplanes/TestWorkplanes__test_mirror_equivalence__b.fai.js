// source: test_workplanes.py::TestWorkplanes::test_mirror_equivalence (var b)
// `for b, p in zip(boxes, planeArg)` — final b = boxes[2], i.e. the same
// translated box as boxTmp (the mirror results live in boxResults, not b).
// ref (cadquery 2.8.0): Solid, vol 1, centered (4, 0, 0.5)
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane('XY'), 1, 1, 1)
b = await cq.translate(b, [4, 0, 0.5])
let result = cq.val(b)
