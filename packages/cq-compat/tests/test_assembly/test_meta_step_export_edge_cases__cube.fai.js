// source: test_assembly.py::test_meta_step_export_edge_cases (var cube)
// cube = cq.Workplane().box(9.8, 9.8, 9.8) — the exportStepMeta edge cases in
// the case are not STEP-observable; the harness exports the cube.
// ref (cadquery 2.8.0 probe): vol 941.192 (= 9.8^3), bbox ±4.9, 6 faces
import * as cq from '@faicad/cq-compat'
let cube = await cq.box(cq.Workplane('XY'), 9.8, 9.8, 9.8)
let result = cq.val(cube)
