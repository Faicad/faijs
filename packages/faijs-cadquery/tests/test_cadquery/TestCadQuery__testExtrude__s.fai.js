// source: test_cadquery.py::TestCadQuery::testExtrude (var s, FINAL value)
// s = Workplane("XY").circle(1).extrude(1, both=False)   (reassigned)
// s = Workplane("XY").circle(1).extrude(1, both=True)
// both=True extrudes ±1 symmetrically about the workplane: cylinder r=1, z[-1,1].
// ref (probed): vol 6.28318530718 (=2π), bbox ±1, topo f4/e5/v3/s1
import * as cq from '@faicad/faijs-cadquery'
let c = cq.circle(cq.Workplane('XY'), 1)
let s = await cq.extrude(c, 1, true, { both: true })
let result = cq.val(s)
