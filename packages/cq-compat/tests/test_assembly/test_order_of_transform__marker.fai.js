// source: test_assembly.py::test_order_of_transform (var marker)
// marker = cq.Workplane().sphere(0.2) — the constraint-solve assertions are
// not STEP-observable; the harness exports the marker sphere itself.
// ref (cadquery 2.8.0 probe): vol 0.033510 (= 4/3*pi*0.2^3), bbox ±0.2, 1 face
import * as cq from '@faicad/cq-compat'
let marker = await cq.sphere(cq.Workplane('XY'), 0.2)
let result = cq.val(marker)
