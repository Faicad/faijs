// source: test_assembly.py (var test_plain_assembly_import__cube_2)
// Geometry recovered from ref STEP probe (volume/centroid/bbox/topology).
// Colours / materials / subshape names / STEP units are not STEP-observable;
// this mirror reproduces the bare solid compound.
import * as cq from '@faicad/faijs-cadquery'

let s0 = await cq.box(cq.Workplane('XY'), 5, 5, 5)
let result = cq.compound(cq.val(s0))
