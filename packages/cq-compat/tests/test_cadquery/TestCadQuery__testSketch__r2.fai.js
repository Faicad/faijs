// source: test_cadquery.py::TestCadQuery::testSketch (var r2)
// r2 = Workplane().sketch().circle(2).wires().offset(0.1, "s").finalize()
//        .sketch().rect(1, 1).finalize().extrude(1, taper=5)
// GOTCHA (probed): upstream's second .sketch() creates a NEW parent workplane
// whose stack holds only sketch2 — the first (annulus) sketch is NOT in the
// final extrude. r2 is the 1×1 rect tapered prism alone.
// ref anchor: vol=0.835228361275, bbox ±0.5 × z[0,1], topo f6/e12/v8
import * as cq from '@faicad/cq-compat'
let sk = cq.sketch(cq.Workplane())
let sk1 = cq.sketchRect(sk, 1, 1)
let wp = cq.sketchFinish(sk1, cq.Workplane())
let r2 = await cq.extrude(wp, 1, true, { taper: 5 })
let result = cq.val(r2)
