// source: test_workplanes.py::TestWorkplanes::test_mirror_equivalence (var boxTmp)
// for i in range(3): boxTmp = Workplane("XY").box(1,1,1).translate([i*2, 0, 0.5])
// The harness snapshots locals at FUNCTION EXIT, so boxTmp = the i=2 iteration.
// ref (cadquery 2.8.0): Solid, vol 1, centered (4, 0, 0.5)
import * as cq from '@faicad/cq-compat'
let boxTmp = await cq.box(cq.Workplane('XY'), 1, 1, 1)
boxTmp = await cq.translate(boxTmp, [4, 0, 0.5])
let result = cq.val(boxTmp)
