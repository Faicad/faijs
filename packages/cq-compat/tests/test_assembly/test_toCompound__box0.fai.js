// source: test_assembly.py::test_toCompound (var box0)
// box0 = cq.Workplane().box(1, 1, 3, centered=(True, True, False)) — a bare
// Solid var, bottom on z=0.
// ref (cadquery 2.8.0 probe): vol 3, bbox x[-0.5,0.5] y[-0.5,0.5] z[0,3]
import * as cq from '@faicad/cq-compat'
let box0 = await cq.box(cq.Workplane('XY'), 1, 1, 3, { centered: [true, true, false] })
let result = cq.val(box0)
