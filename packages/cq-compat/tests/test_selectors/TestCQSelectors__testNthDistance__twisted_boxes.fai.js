// source: test_selectors.py::TestCQSelectors::testNthDistance (var twisted_boxes)
// twisted_boxes = Workplane().box(1,1,1,centered=(True,True,False))
//   .transformed(rotate=(45,0,0), offset=(0,0,3)).box(1,1,1)
// WORKAROUND: cq-compat box() only supports axis-aligned planes. Live probe:
// the upper box is symmetric about (0,0,3) with y/z extents ±0.7071 — i.e. a
// FULLY CENTERED box rotated 45° about world x, translated (0,0,3).
import * as cq from '@faicad/cq-compat'
let lower = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let upper0 = await cq.box(cq.Workplane(), 1, 1, 1)
let upperR = await cq.rotate(upper0, [1, 0, 0], 45)
let upper = await cq.translate(upperR, [0, 0, 3])
let twisted_boxes = await cq.union(lower, upper)
let result = cq.val(twisted_boxes)
