// source: test_free_functions.py::test_solid (var sphere1)
// sphere1 = sphere(0.1).moved(b_large)  -> centre (0,0,0.5)
// ref anchor: vol=0.000523598775598, bbox ±0.05 × z[0.45,0.55], topo f1/e3/v2/s1
// GOTCHA: the ref sphere has RADIUS 0.05, i.e. the upstream free sphere(0.1)
// produced a 0.1-DIAMETER sphere (cq_warehouse semantics differ from
// cadquery.Workplane.sphere(radius)); mirror matches the ref geometry.
import * as cq from '@faicad/cq-compat'
let moved = await cq.translate(cq.Workplane(), [0, 0, 0.5])
let sphere1 = await cq.sphere(moved, 0.05)
let result = cq.val(sphere1)
