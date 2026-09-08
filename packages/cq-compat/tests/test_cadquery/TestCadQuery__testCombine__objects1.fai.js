// source: test_cadquery.py::TestCadQuery::testCombine (var objects1)
// NOTE: upstream reassigns objects1 = s.rect(2.0,2.0).extrude(0.5) in the second
// half of the test, so the exported val() is the plain base box.
import * as cq from '@faicad/cq-compat'
let objects1 = await cq.extrude(cq.rect(cq.Workplane('XY'), 2.0, 2.0), 0.5)
let result = cq.val(objects1)
