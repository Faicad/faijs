// source: test_cadquery.py::TestCadQuery::testWedgePointList (var s, FINAL value)
// s = Workplane("XY").rect(4,4,forConstruction=True).vertices()
//        .wedge(10, 10, 10, 5, 5, 5, 5, combine=False)
// Four wedges at the corner vertices (±2,±2); upstream asserts 4 solids /
// 20 faces / 20 vertices. The STEP capture exports s.val() = objects[0] — the
// FIRST wedge (corner-vertex at (-2,-2)) — so the mirror reproduces only that.
// ref (out/ref/…testWedgePointList__s.step): vol 333.33333333333337, Solid.
import * as cq from '@faicad/faijs-cadquery'
let wp0 = cq.pushPoints(cq.Workplane('XY'), [[-2, -2]])
let s = await cq.wedge(wp0, 10, 10, 10, 5, 5, 5, 5, { combine: false })
let result = cq.val(s)
