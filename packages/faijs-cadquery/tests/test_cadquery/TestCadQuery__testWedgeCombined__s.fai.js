// source: test_cadquery.py::TestCadQuery::testWedgeCombined (var s, FINAL value)
// s = Workplane("XY").rect(4,4,forConstruction=True).vertices()
//        .wedge(10, 10, 10, 5, 5, 5, 5, combine=True)
// Four wedges at the corner vertices (±2,±2), fused into a single solid;
// upstream asserts 1 solid / 12 faces / 16 vertices.
// ref (out/ref/…testWedgeCombined__s.step): vol 912.0000000000001, Compound.
import * as cq from '@faicad/faijs-cadquery'
let wp0 = cq.pushPoints(cq.Workplane('XY'), [[-2, -2], [-2, 2], [2, -2], [2, 2]])
let s = await cq.wedge(wp0, 10, 10, 10, 5, 5, 5, 5, { combine: true })
let result = cq.val(s)
