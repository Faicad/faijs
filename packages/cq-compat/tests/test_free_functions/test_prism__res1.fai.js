// source: test_free_functions.py::test_prism (var res1)
// ftop = box_shape.faces(">Z"); c = circle(0.2).moved(ftop)
// res1 = prism(box_shape, ftop, c, 0.1, (0, 0, 1))  — additive boss on top face
// ref anchor: vol=1.01256637061 (= 1 + π·0.04·0.1), bbox z[0,1.1], topo f8/e15/v10
import * as cq from '@faicad/cq-compat'
let base = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let fz = await cq.faces(base, '>Z')
let wp = await cq.workplane(fz)
wp = await cq.circle(wp, 0.2)
let res1 = await cq.extrude(wp, 0.1)
let result = cq.val(res1)
