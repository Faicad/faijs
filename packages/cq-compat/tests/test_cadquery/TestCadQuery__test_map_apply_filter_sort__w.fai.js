// source: test_cadquery.py::TestCadQuery::test_map_apply_filter_sort (var w)
// w = Workplane().box(1, 1, 1).moveTo(3, 0).box(1, 1, 3).solids()
// Upstream holds TWO separate solids (vols 1 and 3 — the second box does not
// fuse: moveTo drops the previous stack); the ref harness exports w.val() =
// the FIRST solid only (vol 1, box 1x1x1 centered at origin). The cq-compat
// carrier keeps a single shape, so the mirror reproduces the exported solid:
// solids() passes the single box through and val() is that solid.
// ref (probed): vol 1.0.
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane(), 1, 1, 1)
let w = cq.solids(b)
let result = cq.val(w)
