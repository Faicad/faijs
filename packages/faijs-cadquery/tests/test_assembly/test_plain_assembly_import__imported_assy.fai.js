// source: test_assembly.py (var test_plain_assembly_import__imported_assy)
// Geometry recovered from ref STEP probe (volume/centroid/bbox/topology).
// Colours / materials / subshape names / STEP units are not STEP-observable;
// this mirror reproduces the bare solid compound.
import * as cq from '@faicad/faijs-cadquery'

let s0 = await cq.box(cq.Workplane('XY'), 10, 10, 10)
let s0t = await cq.translate(s0, [10, 10, 10])
let s1 = await cq.box(cq.Workplane('XY'), 5, 5, 5)
let s1t = await cq.translate(s1, [20, 20, 20])
let s2 = await cq.box(cq.Workplane('XY'), 5, 5, 5)
let s3 = await cq.box(cq.Workplane('XY'), 5, 5, 5)
let s3t = await cq.translate(s3, [20, 0, 0])
let result = cq.compound(cq.val(s0t), cq.val(s1t), cq.val(s2), cq.val(s3t))
