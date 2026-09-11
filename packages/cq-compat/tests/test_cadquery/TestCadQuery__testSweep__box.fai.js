// source: test_cadquery.py::TestCadQuery::testSweep (var box)
// box = Workplane().box(10, 10, 10, centered=False) — the base solid reused by
// the cut/add sweep cases. ref (cadquery 2.8.0): vol 1000, bbox [0,0,0]..[10,10,10]
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane(), 10, 10, 10, { centered: false })
let result = cq.val(box)
