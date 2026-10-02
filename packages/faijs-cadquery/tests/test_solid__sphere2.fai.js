// source: test_free_functions.py::test_solid (var sphere2)
// sphere2 = sphere1.moved(x=2)  -> centre (2,0,0.5)
// ref anchor: vol=0.000523598775598, bbox x[1.95,2.05] × z[0.45,0.55], topo f1/e3/v2/s1
// GOTCHA: ref radius is 0.05 (see sphere1 — upstream free sphere takes a
// 0.1 DIAMETER), mirror matches the ref geometry.
import * as cq from '@faicad/faijs-cadquery'
let moved = await cq.translate(cq.Workplane(), [2, 0, 0.5])
let sphere2 = await cq.sphere(moved, 0.05)
let result = cq.val(sphere2)
