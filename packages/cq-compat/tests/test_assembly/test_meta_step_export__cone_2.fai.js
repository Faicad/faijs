// source: test_assembly.py (var test_meta_step_export__cone_2)
// Geometry recovered from ref STEP probe (volume/centroid/bbox/topology).
// Colours / materials / subshape names / STEP units are not STEP-observable;
// this mirror reproduces the bare solid compound.
import * as cq from '@faicad/cq-compat'

let s0 = await cq.cone(cq.Workplane('XY'), 2.5, 5, 2.5)
let result = cq.compound(cq.val(s0))
