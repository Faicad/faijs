// source: test_assembly.py (var test_meta_step_export__cylinder_1)
// Geometry recovered from ref STEP probe (volume/centroid/bbox/topology).
// Colours / materials / subshape names / STEP units are not STEP-observable;
// this mirror reproduces the bare solid compound.
import * as cq from '@faicad/faijs-cadquery'

let s0 = await cq.cylinder(cq.Workplane('XY'), 10, 5)
let result = cq.compound(cq.val(s0))
