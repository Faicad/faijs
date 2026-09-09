// source: test_shapes.py::test_reverse (fixture simple_box, reassigned)
// def test_reverse(simple_box): simple_box = box(1, 1, 1)   (free function)
// The reverse() result is asserted but never exported; the exported var is the
// plain free-function box (xy-centred, z 0..1 — centered:[true,true,false]).
// ref (cadquery 2.8.0): Solid, vol 1
import * as cq from '@faicad/cq-compat'
let simple_box = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(simple_box)
