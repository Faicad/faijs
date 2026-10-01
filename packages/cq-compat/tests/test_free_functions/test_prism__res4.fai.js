// source: test_free_functions.py::test_prism (var res4)
// res4 = prism(box_shape, None, c, None, (0, 0, 1), False)  — subtractive through-all
// ref anchor: vol=0.874336293856 (= 1 − π·0.04·1), topo f7/e15/v10
import * as cq from '@faicad/cq-compat'
let base = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let fz = await cq.faces(base, '>Z')
let wp = await cq.workplane(fz)
wp = await cq.circle(wp, 0.2)
let res4 = await cq.cutThruAll(wp)
let result = cq.val(res4)
