// source: test_cadquery.py::TestCadQuery::test_findFromEdge (var part2)
// part2 = Workplane("XY").box(1, 1, 1) — the exported var is the box itself;
// the two _findFromEdge() RuntimeError assertions export nothing.
// ref (cadquery 2.8.0): Solid, vol 1.0, 6 PLANE faces
import * as cq from '@faicad/cq-compat'
let part2 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let result = cq.val(part2)
