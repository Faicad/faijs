// source: test_assembly.py::test_constrain (var b2)
// b2 = cq.Workplane().box(1, 1, 2) — fully centered box.
// ref (cadquery 2.8.0 probe): Solid, vol 2, bbox x/y ±0.5, z ±1
import * as cq from '@faicad/cq-compat'
let b2 = await cq.box(cq.Workplane('XY'), 1, 1, 2)
let result = cq.val(b2)
