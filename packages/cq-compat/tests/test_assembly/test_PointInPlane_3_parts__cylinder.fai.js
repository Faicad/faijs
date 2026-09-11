// source: test_assembly.py::test_PointInPlane_3_parts (var cylinder)
// cylinder = cq.Workplane().circle(0.1).extrude(2) — the constraint/solve
// assertions are not STEP-observable; the harness exports the cylinder itself.
// ref (cadquery 2.8.0 probe): vol 0.062832 (= pi*0.01*2), bbox x/y ±0.1,
// z [0,2], 3 faces
import * as cq from '@faicad/cq-compat'
let wp = await cq.circle(cq.Workplane('XY'), 0.1)
let cylinder = await cq.extrude(wp, 2)
let result = cq.val(cylinder)
