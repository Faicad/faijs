// source: test_cadquery.py::TestCadQuery::test_compound_faces_center (var compound)
// sk = Sketch().rect(50, 50).faces(); face1 = sk.val()
// face2 = face1.copy().translate(Vector(100, 0, 0))
// compound = Compound.makeCompound([face1, face2])
// (the CombinedCenter assert is non-geometry; only the compound is compared)
// ref anchor: vol=0 (two planar faces), bbox x[-25,125] y[-25,25], topo f2/e8/v8
import * as cq from '@faicad/faijs-cadquery'
let w1 = await cq.rect(cq.Workplane(), 50, 50)
let f1 = await cq.face(w1)
let f2 = await cq.translate(f1, [100, 0, 0])
let compound = await cq.compound(cq.val(f1), cq.val(f2))
let result = cq.val(compound)
