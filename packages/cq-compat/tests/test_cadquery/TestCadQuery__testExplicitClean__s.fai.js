// source: test_cadquery.py::TestCadQuery::testExplicitClean (var s)
// s = (Workplane("XY").moveTo(0,0).line(5,0).line(5,0).line(0,10).line(-10,0)
//      .close().extrude(10, clean=False).clean())
// The polygon is (0,0)->(5,0)->(10,0)->(10,10)->(0,10)->close: a 10x10 square,
// extruded 10 -> vol 1000, 6 faces.
import * as cq from '@faicad/cq-compat'
let wp = cq.moveTo(cq.Workplane('XY'), 0, 0)
wp = cq.line(wp, 5, 0)
wp = cq.line(wp, 5, 0)
wp = cq.line(wp, 0, 10)
wp = cq.line(wp, -10, 0)
wp = cq.close(wp)
let e = await cq.extrude(wp, 10)
let s = await cq.clean(e)
let result = cq.val(s)
