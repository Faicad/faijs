// source: test_cadquery.py::TestCadQuery::testClose (var obj2)
// obj2 = Workplane("YZ", origin=(8,-19.5,-1.5)).moveTo(13,-19.5)
//        .sagittaArc((3,-19.5), 2.5).sagittaArc((13,-19.5), 2.5)
//        .close().extrude(3)
// ref (probed): vol 104.83481671912787 — upstream asserts obj1.vol == obj2.vol.
// U16: origin kwarg applied via translate(); moveTo/sagittaArc stay in the
// workplane-LOCAL coordinates exactly as upstream (YZ: xDir=+Y, yDir=+Z).
import * as cq from '@faicad/cq-compat'
let p = await cq.translate(cq.Workplane('YZ'), [8.0, -19.5, -1.5])
let w0 = await cq.moveTo(p, 13.0, -19.5)
let w1 = await cq.sagittaArc(w0, [3.0, -19.5], 2.5)
let w2 = await cq.sagittaArc(w1, [13.0, -19.5], 2.5)
let w3 = await cq.close(w2)
let obj2 = await cq.extrude(w3, 3.0)
let result = cq.val(obj2)
