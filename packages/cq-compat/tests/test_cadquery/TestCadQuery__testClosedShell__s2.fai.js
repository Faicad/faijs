// source: test_cadquery.py::TestCadQuery::testClosedShell (var s2)
// s2 = Workplane("XY").box(2, 2, 2).shell(0.1)
// Walls outward: rounded (arc-joined) outer offset minus the original —
// 32 faces (12 plane + 12 cylinder + 8 sphere), bbox +-1.1,
// vol 2.592684356757526.
// ref (probed): vol 2.592684356757526.
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane('XY'), 2, 2, 2)
let s2 = await cq.shell(b, 0.1)
let result = cq.val(s2)
