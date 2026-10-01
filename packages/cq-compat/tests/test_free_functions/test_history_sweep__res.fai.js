// source: test_free_functions.py::test_history_sweep (var res)
// upstream expression: f1 = plane(1,1) - face(circle(0.1)); f2 = (plane(2,2) -
// face(circle(0.1))).moved(z=1); p = segment((0,0,0),(0,0,1)); sweep([f1,f2], p)
// — a hollow tapered square tube. GOTCHA (probed 2026-10-01): the ref STEP is
// a PLAIN UNIT BOX in [−0.5,0.5]×[−0.5,0.5]×[0,1] (vol=1.0, f6/e12/v8/s1) — a
// ref-side anomaly, NOT the sweep product. The mirror reproduces the ref
// geometry (free-function box placement, z spans [0,1]).
// ref anchor: vol=1, bbox ±0.5 × z[0,1], com (0,0,0.5), topo f6/e12/v8/s1
import * as cq from '@faicad/cq-compat'
let res = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(res)
