// source: test_cadquery.py::TestCadQuery::testUnionNoArgs (var objects2 — final union value)
// objects2 = objects1.add(objects2).union(glue=True, tol=None)
import * as cq from '@faicad/cq-compat'
let objects1 = cq.extrude(cq.rect(cq.Workplane('XY'), 2.0, 2.0), 0.5)
let objects2 = cq.union(objects1, cq.translate(cq.extrude(cq.rect(cq.Workplane('XY'), 1.0, 1.0), 0.5), [0, 0, 0.5]))
let result = cq.val(objects2)
