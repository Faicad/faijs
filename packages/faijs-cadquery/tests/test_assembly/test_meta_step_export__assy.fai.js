// source: test_assembly.py (var test_meta_step_export__assy)
// Geometry recovered from ref STEP probe (volume/centroid/bbox/topology).
// Colours / materials / subshape names / STEP units are not STEP-observable;
// this mirror reproduces the bare solid compound.
import * as cq from '@faicad/faijs-cadquery'

let s0 = await cq.box(cq.Workplane('XY'), 10, 10, 10)
let s1 = await cq.box(cq.Workplane('XY'), 5, 5, 5)
let s1t = await cq.translate(s1, [10, 10, 10])
let s2 = await cq.cylinder(cq.Workplane('XY'), 10, 5)
let s2t = await cq.translate(s2, [-15, 0, 0])
let s3 = await cq.cylinder(cq.Workplane('XY'), 5, 2.5)
let s3t = await cq.translate(s3, [15, -10, -5])
let s4 = await cq.cone(cq.Workplane('XY'), 5, 10, 5)
let s4t = await cq.translate(s4, [-15, 10, 0])
let s5 = await cq.cone(cq.Workplane('XY'), 2.5, 5, 2.5)
let s5t = await cq.translate(s5, [15, 10, -5])
let result = cq.compound(cq.val(s0), cq.val(s1t), cq.val(s2t), cq.val(s3t), cq.val(s4t), cq.val(s5t))
