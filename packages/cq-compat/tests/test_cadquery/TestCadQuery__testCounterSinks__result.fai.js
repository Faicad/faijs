// source: test_cadquery.py::TestCadQuery::testCounterSinks (var result)
// result = s.rect(2.0,4.0).extrude(0.5).faces(">Z").workplane().rect(1.5,3.5,forConstruction=True).vertices().cskHole(0.125, 0.25, 82, depth=None)
import * as cq from '@faicad/cq-compat'
let base = cq.extrude(cq.rect(cq.Workplane('XY'), 2.0, 4.0), 0.5)
let csk = cq.cskHole(cq.vertices(cq.rect(cq.workplane(cq.faces(base, '>Z')), 1.5, 3.5, { forConstruction: true })), 0.125, 0.25, 82)
let result = cq.val(csk)
