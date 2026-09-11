// source: test_cadquery.py::TestCadQuery::testCutBlindUntilFace (var wp_ref_regular_cut)
// wp_ref_regular_cut = wp_ref.faces(">X[2]").workplane(centerOption="CenterOfMass")
//                      .rect(2,2).cutBlind(-10)
// NOTE: cq-compat resolveFaceSelector strips (not implements) the [N] index
// suffix. Upstream ">X[2]" here selects the +X face of the box at x=-15
// (cadquery live probe: face center (-15, 0, 5.5)); cutBlind(-10) cuts a
// 2x2x10 pocket into the x=-20 box. The x=-20 box spans x [-25,-15], so the
// cut through the face plane at x=-15 going -10 into -x direction traverses
// the whole box — reproduced exactly with an explicit cut prism.
// ref (cadquery 2.8.0 probe): vol 3560, com (0.224719, 0, 4.123596), 22 faces
import * as cq from '@faicad/cq-compat'
let base = await cq.box(cq.Workplane('XY'), 40, 10, 2)
let b1 = await cq.box(cq.Workplane('XY'), 10, 10, 10)
let t1 = await cq.translate(b1, [-20, 0, 5])
let u1 = await cq.union(base, t1)
let b2 = await cq.box(cq.Workplane('XY'), 10, 10, 10)
let t2 = await cq.translate(b2, [0, 0, 5])
let u2 = await cq.union(u1, t2)
let b3 = await cq.box(cq.Workplane('XY'), 10, 10, 10)
let t3 = await cq.translate(b3, [20, 0, 5])
let wp_ref = await cq.union(u2, t3)
// pocket: 2x2 square on the face plane x=-15 (z 4.5..6.5, centered on the
// face center z=5.5), prism from x=-15 down to x=-25
let pocket0 = await cq.box(cq.Workplane('XY'), 10, 2, 2, { centered: false })
let pocket = await cq.translate(pocket0, [-25, -1, 4.5])
let wp_ref_regular_cut = await cq.cut(wp_ref, pocket)
let result = cq.val(wp_ref_regular_cut)
