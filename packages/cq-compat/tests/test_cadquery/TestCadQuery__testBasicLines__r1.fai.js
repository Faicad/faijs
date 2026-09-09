// source: test_cadquery.py::TestCadQuery::testBasicLines (var r1)
// r1 = r.faces("+XY").workplane(centerOption="CenterOfMass")
//        .circle(0.08).cutThruAll()
// ref (probed): vol 0.111465, com (0.342, 0.342, 0.125), 6 faces.
// "+XY" is a DirectionSelector: the slant face (normal (1,1,0)/√2) is the only
// face parallel to that diagonal; the hole pierces it and exits the x=0 face.
import * as cq from '@faicad/cq-compat'
let w1 = cq.lineTo(cq.Workplane('XY'), 1, 0)
let w2 = await cq.lineTo(w1, 0, 1)
let w3 = await cq.close(w2)
let w4 = await cq.wire(w3)
let r = await cq.extrude(w4, 0.25)
let f = cq.faces(r, '+XY')
let wp = await cq.workplane(f, { centerOption: 'CenterOfMass' })
let r1 = await cq.cutThruAll(cq.circle(wp, 0.08))
let result = cq.val(r1)
