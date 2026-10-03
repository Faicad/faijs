// source: test_cadquery.py::TestCadQuery::testExtrude (var r, FINAL value)
// box = Workplane().box(5, 5, 5)
// r = box.faces(">Z").workplane(invert=True).circle(0.5).extrude(4, combine="cut")
// combine="cut" is a subtractive extrude (delegates to cutBlind). workplane(invert=True)
// flips the >Z face's outward normal (+Z) to -Z, so a POSITIVE depth cuts *into* the
// solid: an r=0.5 cylindrical pocket 4 deep from the top face (z=+2.5 → z=-1.5).
// ref (probed 2.8.0): vol 121.8584073464102 (=125-π), bbox ±2.5, topo s1
import * as cq from '@faicad/faijs-cadquery'
let b = await cq.box(cq.Workplane('XY'), 5, 5, 5)
let w1 = await cq.workplane(cq.faces(b, '>Z'), { invert: true })
let c = cq.circle(w1, 0.5)
let r = await cq.extrude(c, 4, 'cut')
let result = cq.val(r)
