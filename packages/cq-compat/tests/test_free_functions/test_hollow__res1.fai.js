// source: test_free_functions.py::test_hollow (var res1)
// res1 = hollow(box_shape, None, -0.1)  — walls inward, closed.
// Upstream free `hollow` builds the wall solid as (original − inner offset).
// Equivalent here: Workplane.shell(-0.1) (cut of the kernel inward-offset
// body); volume matches exactly (1 − 0.8^3 = 0.488).
// ref (probed): Solid, vol 0.488, 12 faces.
import * as cq from '@faicad/cq-compat'
let b0 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let res1 = await cq.shell(b0, -0.1)
let result = cq.val(res1)
