// source: test_shapes.py::test_single_ent_selector (var bs)
// bs = box(1, 1, 1).moved((0, 0, 0), (2, 0, 0))
// ref (cadquery 2.8.0): Compound, vol 2 — Shape.moved with TWO locations is a
// compound of one copy per location (no boolean union). Free-function box is
// xy-centred and sits on z=0 (centered:[true,true,false]).
import * as cq from '@faicad/cq-compat'
let b0 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let bs = cq.moved(b0, cq.Location(), cq.Location([2, 0, 0]))
let result = cq.val(bs)
