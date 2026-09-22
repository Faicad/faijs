// source: test_cadquery.py::TestCadQuery::testTagSelectors (var result1)
// result1 = Workplane("XY").pushPoints([(1,0),(-1,0)]).box(1,1,1).tag("boxes").sphere(1)
// NOTE: solids()/shells()(tag=...) counting is Python-side; the exported shape
// is the fused boxes+sphere solid.
import * as cq from '@faicad/cq-compat'
let wp0 = cq.Workplane('XY')
let wp1 = await cq.pushPoints(wp0, [[1, 0], [-1, 0]])
let wp2 = await cq.box(wp1, 1, 1, 1)
let tagged = cq.tag(wp2, 'boxes')
let result = await cq.sphere(tagged, 1)
let resultVal = cq.val(result)
