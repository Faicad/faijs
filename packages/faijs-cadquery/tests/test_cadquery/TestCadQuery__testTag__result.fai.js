// source: test_cadquery.py::TestCadQuery::testTag (var result)
// result = Workplane("XY").pushPoints([(-2,0),(2,0)]).box(1,1,1,combine=False).tag("2 solids").union(Workplane("XY").box(6,1,1))
// NOTE: upstream ref exports result.val() = objects[0] — the FIRST of the two
// tagged boxes (union fusion is a Python-side objects assertion; the reference
// STEP is the standalone box1). faijs val() returns the whole compound, so the
// mirror takes the first solid via solids().
import * as cq from '@faicad/faijs-cadquery'
let wp0 = cq.Workplane('XY')
let wp1 = await cq.pushPoints(wp0, [[-2, 0], [2, 0]])
let wp2 = await cq.box(wp1, 1, 1, 1, { combine: false })
let s = cq.solids(wp2)
let result = cq.val(s)
