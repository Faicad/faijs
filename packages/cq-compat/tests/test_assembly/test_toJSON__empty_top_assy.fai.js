// source: test_assembly.py::test_toJSON (var empty_top_assy)
// empty_top_assy = Assembly(name="top") with one child b (box 1,1,1).
// toJSON bookkeeping is not STEP-observable; the harness exports the assembly
// compound = the single centered box.
// ref (cadquery 2.8.0 probe): vol 1, bbox ±0.5, 6 faces
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let result = cq.val(b)
