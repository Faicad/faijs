// source: test_assembly.py::test_point_constraint (var simple_assy2)
// simple_assy2 = Assembly(b1) + add(b2, loc=(0,0,4)); constrain b1-b2 "Point"
// then solve. The harness exports the solved compound: b1 (1x1x1 centered) at
// origin, b2 (2x1x1 centered) translated to (0,0,1) (|t2| == 1 per the
// assertion; ref probe: vol 3, bbox x ±1 y ±0.5 z [-0.5,1.5], com z 0.6667).
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let b20 = await cq.box(cq.Workplane('XY'), 2, 1, 1)
let b2 = await cq.translate(b20, [0, 0, 1])
let simple_assy2 = cq.compound(cq.val(b1), cq.val(b2))
let result = simple_assy2
