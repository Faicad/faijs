// source: test_cadquery.py::TestCadQuery::testOpenCornerShell (var s)
// self.saveModel(s1.shell(0.2)) with s1 = s.faces("+Z").add(s.faces("+Y")).add(s.faces("+X")).
// The ref plugin exported the inline expression's base var: probed ref STEP is
// the UN-shelled box (vol 1.0, 6 PLANE) — live cadquery 2.8.0 shell() gives
// vol 0.698 / 13 faces, so the harness captured `s`, not the shell result.
// Mirror reproduces the ref geometry (the base box).
// ref (cadquery 2.8.0): Solid, vol 1.0, 6 PLANE faces
import * as cq from '@faicad/cq-compat'
let s = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let result = cq.val(s)
