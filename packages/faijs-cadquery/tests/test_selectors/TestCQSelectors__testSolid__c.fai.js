// source: test_selectors.py::TestCQSelectors::testSolid (var c)
// c = CQ(makeUnitCube(False)) — Solid.makeBox → fully centred cube; solids/faces/edges/vertices counts in-process; exports cube.
import * as cq from '@faicad/faijs-cadquery'
let c = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [false, false, false] })
let result = cq.val(c)
