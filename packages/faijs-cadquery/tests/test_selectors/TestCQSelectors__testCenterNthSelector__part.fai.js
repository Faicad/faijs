// source: test_selectors.py::TestCQSelectors::testCenterNthSelector (var part)
// part = box0.add(box1) — CQ Workplane.add appends to objects and val()
// returns objects[0], so the exported geometry is box0 alone (vol 1), NOT
// a union of the two cubes. Mirror exports val(box0) to match the ref STEP.
import * as cq from '@faicad/faijs-cadquery'
let box0 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: true })
let box1 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: true })
let box1m = cq.moved(box1, cq.Location([10, 10, 10]))
let result = cq.val(box0)
