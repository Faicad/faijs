// source: test_cadquery.py::TestCadQuery::testGlue (var box2)
// box2 = Workplane("XY", origin=(0, 1, 0)).rect(1, 1).extrude(1)
// ref (probed): vol 1.000000, bbox x in [-0.5,0.5], y in [0.5,1.5], z in [0,1].
// U16: cq-compat Workplane() ignores the origin kwarg (upstream accepts it), so
// the offset is applied with translate() on the empty workplane — that moves
// wp.origin, which is where rect()/extrude() then build the solid.
import * as cq from '@faicad/cq-compat'
let p = await cq.translate(cq.Workplane('XY'), [0, 1, 0])
let w1 = cq.rect(p, 1, 1)
let box2 = await cq.extrude(w1, 1)
let result = cq.val(box2)
