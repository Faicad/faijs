// source: test_selectors.py::TestCQSelectors::testAreaNthSelector_NonplanarWire (var wp)
// wp = Workplane("XY").circle(10).extrude(50) — the AreaNthSelector
// assertions are not STEP-observable; the harness exports the cylinder
// (probe: vol 15707.963 = pi*100*50, 3 faces).
import * as cq from '@faicad/cq-compat'
let wp = await cq.cylinder(cq.Workplane('XY'), 50, 10, { centered: [true, true, false] })
let result = cq.val(wp)
