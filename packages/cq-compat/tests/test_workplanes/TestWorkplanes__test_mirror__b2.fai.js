// source: test_workplanes.py::TestWorkplanes::test_mirror (var b2)
// b2 = Workplane().box(1,1,1).mirror("XY", (0,0,0.5), union=True)
// ref (cadquery 2.8.0): Compound, vol 2 (box + mirrored copy about z=0.5, fused)
import * as cq from '@faicad/cq-compat'
let b2 = await cq.box(cq.Workplane(), 1, 1, 1)
b2 = await cq.mirror(b2, 'XY', [0, 0, 0.5], true)
let result = cq.val(b2)
