// source: test_assembly.py::test_constrain (var b1)
// b1 = cq.Solid.makeBox(1, 1, 1) — free-function-style box from the origin
// (x/y/z [0,1]), NOT centered.
// ref (cadquery 2.8.0 probe): Solid, vol 1, bbox [0,1]^3
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: false })
let result = cq.val(b1)
