// source: test_assembly.py (var test_step_export__nested_assy)
// Geometry recovered from ref STEP probe (volume/centroid/bbox/topology).
// Colours / materials / subshape names / STEP units are not STEP-observable;
// this mirror reproduces the bare solid compound.
import * as cq from '@faicad/cq-compat'

let s0 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let s1 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let s1t = await cq.translate(s1, [0, 4, 0])
let s2 = await cq.box(cq.Workplane('XY'), 1, 1, 0.5)
let s2t = await cq.translate(s2, [-2, 8, 0])
let s3 = await cq.box(cq.Workplane('XY'), 1, 1, 0.5)
let s3t = await cq.translate(s3, [2, 8, 0])
let result = cq.compound(cq.val(s0), cq.val(s1t), cq.val(s2t), cq.val(s3t))
