// source: test_cadquery.py::TestCadQuery::test_iterators (var fs)
// fs = w.faces(">Z").combine().val() where w is the two-box compound at x=0/x=2.
// Compound of the TWO TOP FACES (z=0.5, one per box).
// ref (cadquery 2.8.0): Compound (2 faces, 8 edges), bbox z=[0.5, 0.5]
import * as cq from '@faicad/cq-compat'
let p = cq.pushPoints(cq.Workplane('XY'), [[0, 0], [2, 0]])
let w = await cq.box(p, 1, 1, 1)
let fs = await cq.faceCompound(w, '>Z')
let result = cq.val(fs)
