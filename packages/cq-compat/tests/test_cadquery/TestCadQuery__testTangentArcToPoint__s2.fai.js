// source: test_cadquery.py::TestCadQuery::testTangentArcToPoint (var s2)
// pts = [(sin(a), cos(a)) for a in [0, 0.15pi, ..., 1.35pi]]  (inlined below)
// s2 = Workplane("XY").spline(pts)
//      .tangentArcPoint((0,1), relative=False).close().extrude(1)
// ref (probed): vol 3.126378 (upstream asserts approx(pi, 1)), 4 faces.
// The spline is the FIRST edge (no gap quirk here — the tangent arc closes the
// unit-circle segment exactly back to the spline start (0,1), so close() adds
// no segment). The end tangent is captured from the kernel edge at spline-op
// time and reused at wire-assembly time.
import * as cq from '@faicad/cq-compat'
let pts = [
  [0.0, 1.0],
  [0.45399049973954675, 0.8910065241883679],
  [0.8090169943749475, 0.5877852522924731],
  [0.9876883405951378, 0.15643446504023092],
  [0.9510565162951536, -0.30901699437494734],
  [0.7071067811865476, -0.7071067811865475],
  [0.3090169943749475, -0.9510565162951535],
  [-0.15643446504023073, -0.9876883405951378],
  [-0.587785252292473, -0.8090169943749475],
  [-0.8910065241883678, -0.4539904997395469],
]
let w0 = cq.spline(cq.Workplane('XY'), pts)
let w1 = await cq.tangentArcPoint(w0, [0, 1], false, false)
let w2 = await cq.close(w1)
let s2 = await cq.extrude(w2, 1)
let result = cq.val(s2)
