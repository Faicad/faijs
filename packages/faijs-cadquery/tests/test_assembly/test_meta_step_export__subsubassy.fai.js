// source: test_assembly.py (var test_meta_step_export__subsubassy)
// Geometry recovered from ref STEP probe (volume/centroid/bbox/topology).
// Colours / materials / subshape names / STEP units are not STEP-observable;
// this mirror reproduces the bare solid compound.
import * as cq from '@faicad/faijs-cadquery'

let s0 = await cq.cone(cq.Workplane('XY'), 5, 10, 5)
let s0t = await cq.translate(s0, [-15, 10, 0])
let s1 = await cq.cone(cq.Workplane('XY'), 2.5, 5, 2.5)
let s1t = await cq.translate(s1, [15, 10, -5])
let result = cq.compound(cq.val(s0t), cq.val(s1t))
