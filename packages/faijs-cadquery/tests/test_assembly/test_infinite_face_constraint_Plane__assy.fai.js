// source: test_assembly.py (var test_infinite_face_constraint_Plane__assy)
// Geometry recovered from ref STEP probe (volume/centroid/bbox/topology).
// Colours / materials / subshape names / STEP units are not STEP-observable;
// this mirror reproduces the bare solid compound.
import * as cq from '@faicad/faijs-cadquery'

let s0 = await cq.sphere(cq.Workplane('XY'), 1)
let s1 = await cq.sphere(cq.Workplane('XY'), 1)
let result = cq.compound(cq.val(s0), cq.val(s1))
