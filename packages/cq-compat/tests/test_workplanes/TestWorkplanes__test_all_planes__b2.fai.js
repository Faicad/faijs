// source: test_workplanes.py::TestWorkplanes::test_all_planes (var b2)
// b2 = Workplane().box(1,1,1); for p in [XY,YX,XZ,ZX,YZ,ZY]: b2 = b2.mirror(p)
// ref (cadquery 2.8.0): Solid, vol 1 — union=False mirrors REPLACE the shape,
// and the box is centered on the origin so every mirror leaves it unchanged.
// Unrolled (no loop construct in the .fai.js subset).
import * as cq from '@faicad/cq-compat'
let b2 = await cq.box(cq.Workplane(), 1, 1, 1)
b2 = await cq.mirror(b2, 'XY')
b2 = await cq.mirror(b2, 'YX')
b2 = await cq.mirror(b2, 'XZ')
b2 = await cq.mirror(b2, 'ZX')
b2 = await cq.mirror(b2, 'YZ')
b2 = await cq.mirror(b2, 'ZY')
let result = cq.val(b2)
