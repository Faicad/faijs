// source: test_cadquery.py::TestCadQuery::testCubePlugin (var result)
// 4 unit cubes with their bbox CORNER at the rect(4,4) vertices on the top
// face (z=0.25), combined into a compound; the base box is NOT part of result.
import * as cq from '@faicad/cq-compat'
let base = await cq.box(cq.Workplane('XY'), 6.0, 8.0, 0.5)
let wp0 = await cq.workplane(cq.faces(base, '>Z'))
let wp1 = cq.pushPoints(wp0, [[2, 2], [2, -2], [-2, 2], [-2, -2]])
let cubes = await cq.box(wp1, 1, 1, 1, { centered: false, combine: false })
let result = cq.val(cubes)
