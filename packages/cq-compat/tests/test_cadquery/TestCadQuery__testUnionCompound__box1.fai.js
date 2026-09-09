// source: test_cadquery.py::TestCadQuery::testUnionCompound (var box1)
// box1 = Workplane("XY").box(10, 20, 30)
// ref (cadquery 2.8.0): Solid, vol 6000
import * as cq from '@faicad/cq-compat'
let box1 = await cq.box(cq.Workplane('XY'), 10, 20, 30)
let result = cq.val(box1)
