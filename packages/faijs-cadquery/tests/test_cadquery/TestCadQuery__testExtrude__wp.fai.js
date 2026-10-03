// source: test_cadquery.py::TestCadQuery::testExtrude (var wp, FINAL value)
// wp_ref = Workplane("XY").rect(40,40).extrude(20, both=True)
// wp = wp_ref.workplane().rect(20,20).extrude(20, both=True, combine="s")
// combine="s" is a subtractive extrude (delegates to cutBlind): a 20×20 pocket cut
// ±20 about the workplane (z=0) → through hole in the 40×40×40 box.
// ref (probed): vol 48000 (=64000-16000), bbox ±20, topo f10/e24/v16/s1
import * as cq from '@faicad/faijs-cadquery'
let r = cq.rect(cq.Workplane('XY'), 40, 40)
let wp_ref = await cq.extrude(r, 20, true, { both: true })
let w1 = await cq.workplane(wp_ref)
let r2 = cq.rect(w1, 20, 20)
let wp = await cq.extrude(r2, 20, 's', { both: true })
let result = cq.val(wp)
