// source: test_cadquery.py::TestCadQuery::testClosedShell (var s1)
// s1 = Workplane("XY").box(2, 2, 2).shell(-0.1)
// Closed hollow, walls inward: 12 faces, vol 2.168 (= 8 - 1.8^3).
// ref (probed): vol 2.168.
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane('XY'), 2, 2, 2)
let s1 = await cq.shell(b, -0.1)
let result = cq.val(s1)
