// source: test_cadquery.py::TestCadQuery::testExtrude (var wp_ref)
// wp_ref = Workplane("XY").rect(40, 40).extrude(20, both=True)
// both=True extrudes ±20 symmetrically: 40×40×40 box, bbox ±20.
// ref (probed): vol 64000, bbox ±20, topo f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let r = cq.rect(cq.Workplane('XY'), 40, 40)
let wp_ref = await cq.extrude(r, 20, true, { both: true })
let result = cq.val(wp_ref)
