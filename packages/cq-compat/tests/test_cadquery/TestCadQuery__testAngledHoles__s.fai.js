// source: test_cadquery.py::TestCadQuery::testAngledHoles (var s)
// s = Workplane("front").box(4.0,4.0,0.25).faces(">Z").workplane()
//     .transformed(offset=Vector(0,-1.5,1.0), rotate=Vector(60,0,0))
//     .rect(1.5,1.5,forConstruction=True).vertices().hole(0.25)
// cq-compat now carries the full named-plane table; front == XY axes (verified vs cadquery 2.8.0)
import * as cq from '@faicad/cq-compat'
let s = cq.hole(cq.vertices(cq.rect(cq.transformed(cq.workplane(cq.faces(cq.box(cq.Workplane('front'), 4.0, 4.0, 0.25), '>Z')), { offset: [0, -1.5, 1.0], rotate: [60, 0, 0] }), 1.5, 1.5, { forConstruction: true })), 0.25)
let result = cq.val(s)
