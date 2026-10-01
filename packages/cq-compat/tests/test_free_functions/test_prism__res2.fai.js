// source: test_free_functions.py::test_prism (var res2)
// res2 = prism(box_shape, ftop, c, -0.1, (0, 0, 1), False)  — subtractive boss
// ref anchor: vol=0.987433629386 (= 1 − π·0.04·0.1), topo f8/e15/v10
import * as cq from '@faicad/cq-compat'
let base = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let fz = await cq.faces(base, '>Z')
let wp = await cq.workplane(fz)
wp = await cq.circle(wp, 0.2)
let res2 = await cq.cutBlind(wp, -0.1)
let result = cq.val(res2)
