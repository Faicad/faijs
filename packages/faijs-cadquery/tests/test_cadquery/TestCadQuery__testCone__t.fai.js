// source: test_cadquery.py::TestCadQuery::testCone (var t, FINAL value)
// t = CQ(s)  — upstream `CQ = Workplane` (cq.py:4565), so `CQ(s)` is an XY
// workplane whose stack holds the cone; the test asserts t.faces().size() == 2.
// ref (out/ref/…testCone__t.step): same geometry as __s —
// vol 2.09439510239, com z 1.5, bbox x[-1,1] y[-1,1] z[0,2], topo f2/e3/v2/s1
//
// GOTCHA (mirror convention, B0-6): `solidMakeCone` is inlined into the `CQ(…)`
// argument instead of being bound to its own `let`. A statement that binds a
// raw SHAPE (`let s = await cq.solidMakeCone(...)`) is not marked consumed by
// the following `cq.CQ(s)` call, so the CLI would export TWO terminals
// (`_0_s.step` + `_1_result.step`) and the case stays BLOCKED. Workplane-valued
// intermediates (`t` above) are fine — only `result` is a terminal.
import * as cq from '@faicad/faijs-cadquery'
let t = await cq.CQ(cq.solidMakeCone(0, 1.0, 2.0))
let result = cq.val(t)
