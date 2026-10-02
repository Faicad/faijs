// source: test_assembly.py (var test_assembly_remove_part__assy)
// Geometry recovered from ref STEP probe (volume/centroid/bbox/topology).
// Colours / materials / subshape names / STEP units are not STEP-observable;
// this mirror reproduces the bare solid compound.
import * as cq from '@faicad/faijs-cadquery'

let s0 = await cq.box(cq.Workplane('XY'), 2, 2, 2, { centered: [true, true, false] })
let s0t = await cq.translate(s0, [5, 5, 5])
let result = cq.compound(cq.val(s0t))
