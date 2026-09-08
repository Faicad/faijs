// source: test_cadquery.py::TestCadQuery::testSphereCombine (var s)
// s = Workplane("XY").rect(4,4,forConstruction=True).vertices().sphere(2.25, combine=True)
import * as cq from '@faicad/cq-compat'
let wp0 = cq.rect(cq.Workplane('XY'), 4.0, 4.0, { forConstruction: true })
let wp1 = cq.vertices(wp0)
let s = await cq.sphere(wp1, 2.25, { combine: true })
let result = cq.val(s)
