// source: test_cadquery.py::TestCadQuery::testTagSelectors (var result2)
// result2 = Workplane("XY").rect(4,4).vertices().box(1,1,1,combine=False).tag("4 objs")
// result2 = result2.newObject([Compound.makeCompound(result2.objects)])
// NOTE: compounds(tag=...)==0 is Python-side; the exported shape is the
// compound of the four per-vertex boxes. faijs rect defaults to
// forConstruction=false, so pass it explicitly (upstream default true).
import * as cq from '@faicad/faijs-cadquery'
let wp0 = cq.Workplane('XY')
let wp1 = await cq.rect(wp0, 4, 4, { forConstruction: true })
let wp2 = await cq.vertices(wp1)
let wp3 = await cq.box(wp2, 1, 1, 1, { combine: false })
let tagged = cq.tag(wp3, '4 objs')
let result = tagged
let resultVal = cq.val(result)
