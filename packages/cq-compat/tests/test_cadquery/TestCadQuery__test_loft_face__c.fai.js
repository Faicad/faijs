// source: test_cadquery.py::TestCadQuery::test_loft_face (var c)
// f1 = plane(1, 1); f2 = face(circle(1)).moved(z=1); c = compound(f1, f2)
// Compound of the two loft input faces: a 1x1 square at z=0 and a r=1 disc at
// z=1. No boolean is involved (upstream `compound` just bundles shapes).
// ref (cadquery 2.8.0): Compound, 2 PLANE faces (area 1.0 + pi)
import * as cq from '@faicad/cq-compat'
let w1r = await cq.rect(cq.Workplane('XY'), 1, 1)
let f1 = await cq.face(w1r)
let w2c = await cq.circle(cq.Workplane('XY'), 1)
let f2b = await cq.face(w2c)
let f2 = await cq.moved(f2b, cq.Location(0, 0, 1))
let result = cq.compound(f1, f2)
