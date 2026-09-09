// source: test_workplanes.py::TestWorkplanes::test_mirror_axis (var b2)
// b2 = Workplane().box(1,1,1).mirror((0,0,1), (0,0,0.5), union=True)
// ref (cadquery 2.8.0): Compound, vol 2 (vector + base-point mirror form)
import * as cq from '@faicad/cq-compat'
let b2 = await cq.box(cq.Workplane(), 1, 1, 1)
b2 = await cq.mirror(b2, [0, 0, 1], [0, 0, 0.5], true)
let result = cq.val(b2)
