// source: test_cadquery.py::TestCadQuery::testSolidReferencesCombineTrue (var t)
// t = r.faces(">Z").workplane().rect(0.25, 0.25).extrude(0.5, True)
// boss fused onto the plate: vol 2 + 0.25*0.25*0.5 = 2.03125
// ref (cadquery 2.8.0): Compound, vol 2.03125
import * as cq from '@faicad/cq-compat'
let s = cq.Workplane('XY')
let r = await cq.extrude(cq.rect(s, 2, 2), 0.5)
let w = await cq.workplane(cq.faces(r, '>Z'))
let t = await cq.extrude(cq.rect(w, 0.25, 0.25), 0.5)
let result = cq.val(t)
