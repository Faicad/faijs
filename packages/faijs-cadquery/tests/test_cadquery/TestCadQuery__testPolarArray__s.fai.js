// source: test_cadquery.py::TestCadQuery::testPolarArray (var s, FINAL state)
// s = Workplane().center(2, -4).polarArray(2, 10, 50, 3).rect(1.0, 0.5).extrude(1)
// GOTCHA: polarArray(2, 10, 50, 3) with the DEFAULT fill=True gives step =
// 50/(3-1) = 25° → points at 10°, 35°, 60° (NOT 360/3 = 120° spacing), and
// rotate=True rotates each rect about its own centre by the same angle.
// Upstream asserts the >Y and >Z vertex is (3.0334936490538906,
// -1.7099364905389036, 1.0) — i.e. the 60° rect's rotated corner.
import * as cq from '@faicad/faijs-cadquery'
let c = cq.center(cq.Workplane('XY'), 2, -4)
let pa = cq.polarArray(c, 2, 10, 50, 3)
let rp = cq.rect(pa, 1.0, 0.5)
let s = await cq.extrude(rp, 1)
let result = cq.val(s)
