// source: test_sketch.py::test_modes (sketch + extrude outlet, brep side)
// sketch().rect(2,2).rect(1,1, mode="s").extrude(2) -> solid volume 6
// NOTE: upstream Sketch is a 2D face container (zero STEP volume) so this
// mirror exports the EXTRUDED solid to give the compare chain a target.
import * as cq from '@faicad/cq-compat'
let s0 = cq.sketchCreate()
let s1 = cq.sketchRect(s0, 2, 2)
let s2 = cq.sketchRect(s1, 1, 1, { mode: 's' })
let result = cq.sketchExtrude(s2, 2)
