// source: test_assembly.py (var test_step_export_filesize__part)
// Geometry recovered from ref STEP probe (volume/centroid/bbox/topology).
// Colours / materials / subshape names / STEP units are not STEP-observable;
// this mirror reproduces the bare solid compound.
import * as cq from '@faicad/cq-compat'

let s0 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let result = cq.compound(cq.val(s0))
