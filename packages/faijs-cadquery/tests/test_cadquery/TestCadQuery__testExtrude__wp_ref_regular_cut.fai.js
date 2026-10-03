// source: test_cadquery.py::TestCadQuery::testExtrude (var wp_ref_regular_cut)
// wp_ref_regular_cut = wp_ref.workplane(offset=-20).rect(20,20).extrude(40, combine="s")
// combine="s" is a subtractive extrude (delegates to cutBlind): a 20×20 pocket cut
// 40 deep from the bottom face (z=-20) → through hole in the 40×40×40 box.
// ref (probed): vol 48000, bbox ±20, topo f10/e24/v16/s1
import * as cq from '@faicad/faijs-cadquery'
let r = cq.rect(cq.Workplane('XY'), 40, 40)
let wp_ref = await cq.extrude(r, 20, true, { both: true })
let w1 = await cq.workplane(wp_ref, { offset: -20 })
let r2 = cq.rect(w1, 20, 20)
let wp_ref_regular_cut = await cq.extrude(r2, 40, 's')
let result = cq.val(wp_ref_regular_cut)
