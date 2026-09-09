// source: test_workplanes.py::TestWorkplanes::test_bad_plane_input (var b2)
// b2 = Workplane().box(1,1,1); b2.mirror(b2.edges()) raises ValueError (caught
// by upstream assertRaises), so the FINAL value of b2 is still the plain box.
// ref (cadquery 2.8.0): Solid, vol 1
import * as cq from '@faicad/cq-compat'
let b2 = await cq.box(cq.Workplane(), 1, 1, 1)
let result = cq.val(b2)
