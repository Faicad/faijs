// source: test_free_functions.py::test_offset (var r4)
// f = plane(1, 1);  r4 = offset(f.moved((0, 0), (5, 5)), 1, both=True)
// `Shape.moved(p1, p2, ...)` with SEVERAL locations is the multi-location overload
// (shapes.py:1360 -> :1323, `_compound_or_shape`): it yields a Compound of the face
// placed at EACH location, NOT a single translated copy. offset's `_get` therefore
// sees two faces, and both=True unions their +t/-t thickenings.
// ref (cadquery 2.8.0): Compound vol 4 | 20 faces, 40 edges, 24 verts | bb (-0.5..5.5)^2 z[-1,1]
import * as cq from '@faicad/faijs-cadquery'
let f = await cq.plane(1, 1)
let fm = await cq.moved(f, cq.Location([0, 0, 0]), cq.Location([5, 5, 0]))
let r4 = await cq.offset(fm, 1, { both: true })
let result = cq.val(r4)
