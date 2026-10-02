// source: test_cadquery.py::TestCadQuery::testEachpoint (var r, object form)
// r = box.faces().eachpoint(sph, combine=True)
// sphere placed at each of the six face COMs, fused into the 2×2×2 base
// ref anchor: vol=20.5663706144 (= 8 + 3×sphere), topo f30/e60/v22/s1
import * as cq from '@faicad/faijs-cadquery'
let box = await cq.box(cq.Workplane(), 2, 2, 2)
let fz = cq.faces(box, '')
let sph = await cq.sphere(cq.Workplane(), 1)
let r = await cq.eachpoint(fz, sph, { combine: true })
let result = cq.val(r)
