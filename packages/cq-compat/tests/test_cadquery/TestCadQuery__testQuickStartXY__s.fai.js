// source: test_cadquery.py::TestCadQuery::testQuickStartXY (var s)
// s = Workplane(Plane.XY()).box(2,4,0.5).faces(">Z").workplane()
//       .rect(1.5,3.5,forConstruction=True).vertices().cskHole(0.125,0.25,82,depth=None)
// depth=None -> through hole (cq-compat cskHole has no depth arg; through is the default).
import * as cq from '@faicad/cq-compat'
let base = await cq.box(cq.Workplane('XY'), 2, 4, 0.5)
let top = await cq.faces(base, '>Z')
let wp = await cq.workplane(top)
let r = cq.rect(wp, 1.5, 3.5, { forConstruction: true })
let v = cq.vertices(r)
let s = await cq.cskHole(v, 0.125, 0.25, 82)
let result = cq.val(s)
