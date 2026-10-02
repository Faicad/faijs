// source: test_cadquery.py::TestCadQuery::testSlot2D (var result, FINAL state)
// result is rebound three times; the ref STEP is the last one:
//   result = Workplane("XY").slot2D(4, 1, 45).extrude(1)
// (upstream asserts only that the rotated slot's top-face >X edge endpoint is
//  (0.707106781, 1.414213562, 1.0); the exported geometry is the 45° slot.)
import * as cq from '@faicad/faijs-cadquery'
let s = await cq.slot2D(cq.Workplane('XY'), 4, 1, 45)
let result = await cq.extrude(s, 1)
let out = cq.val(result)
