// source: test_selectors.py::TestCQSelectors::testBox (var c)
// c = CQ(makeUnitCube(centered=False)) — Solid.makeBox → fully centred unit cube; BoxSelector vertex picks in-process; exports cube (vol 1).
import * as cq from '@faicad/cq-compat'
let c = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [false, false, false] })
let result = cq.val(c)
