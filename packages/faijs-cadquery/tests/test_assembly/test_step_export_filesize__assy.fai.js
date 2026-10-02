// source: test_assembly.py (var test_step_export_filesize__assy)
// Geometry recovered from ref STEP probe (volume/centroid/bbox/topology).
// Colours / materials / subshape names / STEP units are not STEP-observable;
// this mirror reproduces the bare solid compound.
import * as cq from '@faicad/faijs-cadquery'

let s0 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let s0t = await cq.translate(s0, [1, 0, 0])
let s1 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let s1t = await cq.translate(s1, [2, 0, 0])
let s2 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let s2t = await cq.translate(s2, [3, 0, 0])
let s3 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let s3t = await cq.translate(s3, [4, 0, 0])
let s4 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let s4t = await cq.translate(s4, [5, 0, 0])
let s5 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let s5t = await cq.translate(s5, [6, 0, 0])
let s6 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let s6t = await cq.translate(s6, [7, 0, 0])
let s7 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let s7t = await cq.translate(s7, [8, 0, 0])
let s8 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let s8t = await cq.translate(s8, [9, 0, 0])
let s9 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let s9t = await cq.translate(s9, [10, 0, 0])
let result = cq.compound(cq.val(s0t), cq.val(s1t), cq.val(s2t), cq.val(s3t), cq.val(s4t), cq.val(s5t), cq.val(s6t), cq.val(s7t), cq.val(s8t), cq.val(s9t))
