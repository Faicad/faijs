// source: test_cadquery.py::TestCadQuery::testBasicLines (var r)
// r = s.lineTo(1.0, 0).lineTo(0, 1.0).close().wire().extrude(0.25)
// ref (probed): vol 0.125000, com (0.333333, 0.333333, 0.125000), 5 faces.
// The explicit .wire() after .close() is a no-op (close already consumed the
// pending edges) — upstream `wire()` returns self when no free edges remain.
// r1/r2 (same test) are mirrored separately — faces("+XY") is the Direction
// Selector form (normal-parallel filter, selectors.py:234), now supported.
import * as cq from '@faicad/cq-compat'
let w1 = cq.lineTo(cq.Workplane('XY'), 1, 0)
let w2 = await cq.lineTo(w1, 0, 1)
let w3 = await cq.close(w2)
let w4 = await cq.wire(w3)
let r = await cq.extrude(w4, 0.25)
let result = cq.val(r)
