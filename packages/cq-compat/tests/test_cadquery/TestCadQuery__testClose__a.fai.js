// source: test_cadquery.py::TestCadQuery::testClose (var a)
// a = Workplane(Plane.XY()).sagittaArc((10, 0), 2).close().extrude(2)
// ref (probed): vol 27.501465787874714, 4 faces.
// Positive sag bulges LEFT of the start->end direction (upstream sag-vector
// +90° rotation), so the profile is a chord + convex arc segment.
import * as cq from '@faicad/cq-compat'
let w0 = cq.sagittaArc(cq.Workplane('XY'), [10, 0], 2)
let w1 = await cq.close(w0)
let a = await cq.extrude(w1, 2)
let result = cq.val(a)
