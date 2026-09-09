// source: test_cadquery.py::TestCadQuery::testRevolveCut (var cut)
// ref (cadquery 2.8.0): vol 914.159265, 19 faces, bbox [-5,-5,-5]..[5,5,5]
//   cut = box.transformed((90,0,0)).move(5,0).rect(3,4,centered=False)
//         .revolve(360, (0,0,0), (0,1,0), combine="cut")
//
// NOTE: upstream `move(5,0)` pushes the point onto the stack and rect draws at
// every stack item — empirically identical to pushPoints([(5,0)]) (verified in
// cadquery 2.8.0: both chains give vol 914.159265). Axis endpoints are LOCAL
// coords of the rotated plane: (0,0,0)->(0,1,0) local == world +Z axis.
import * as cq from '@faicad/cq-compat'
let box = await cq.box(cq.Workplane(), 10, 10, 10)
let t = await cq.transformed(box, { rotate: [90, 0, 0] })
let p = cq.pushPoints(t, [[5, 0]])
let r = cq.rect(p, 3, 4, { centered: false })
let cut = await cq.revolve(r, 360, [0, 0, 0], [0, 1, 0], 'cut')
let result = cq.val(cut)
