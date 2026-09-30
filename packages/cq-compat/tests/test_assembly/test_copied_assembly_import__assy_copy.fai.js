// source: test_assembly.py (var test_copied_assembly_import__assy_copy)
// Geometry recovered from ref STEP probe (volume/centroid/bbox/topology).
// Colours / materials / subshape names / STEP units are not STEP-observable;
// this mirror reproduces the bare solid compound.
import * as cq from '@faicad/cq-compat'

let s0 = await cq.box(cq.Workplane('XY'), 1, 2, 5, { centered: [true, true, false] })
let s1 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let s1t = await cq.translate(s1, [5, 5, 0])
let s2 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let s2t = await cq.translate(s2, [-5, 5, 0])
let s3 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let s3t = await cq.translate(s3, [-5, -5, 0])
let s4 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let s4t = await cq.translate(s4, [5, -5, 0])
let result = cq.compound(cq.val(s0), cq.val(s1t), cq.val(s2t), cq.val(s3t), cq.val(s4t))
