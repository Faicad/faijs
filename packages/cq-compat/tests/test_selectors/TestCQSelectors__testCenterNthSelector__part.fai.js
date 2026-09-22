// source: test_selectors.py::TestCQSelectors::testCenterNthSelector (var part)
// part = box0.add(box1) — two separated cubes; union keeps 2 solids (vol 2).
import * as cq from '@faicad/cq-compat'
let box0 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: true })
let box1 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: true })
let box1m = cq.moved(box1, cq.Location([10, 10, 10]))
let part = await cq.union(box0, box1m)
let result = cq.val(part)
