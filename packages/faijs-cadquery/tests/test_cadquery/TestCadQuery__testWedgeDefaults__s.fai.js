// source: test_cadquery.py::TestCadQuery::testWedgeDefaults (var s, FINAL value)
// s = Workplane("XY").wedge(10, 10, 10, 5, 5, 5, 5)
// Degenerate top: xmin==xmax==5 and zmin==zmax==5, so the top face collapses to
// the single point (5, 10, 5) => a right square pyramid. Upstream asserts
// 1 solid, 5 faces, 5 vertices.
// ref (out/ref/…testWedgeDefaults__s.step): vol 333.33333333333337, Solid.
import * as cq from '@faicad/faijs-cadquery'
let wp_out = await cq.wedge(cq.Workplane('XY'), 10, 10, 10, 5, 5, 5, 5)
let result = cq.val(wp_out)
