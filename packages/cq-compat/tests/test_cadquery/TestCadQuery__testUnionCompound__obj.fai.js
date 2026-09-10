// source: test_cadquery.py::TestCadQuery::testUnionCompound (var obj)
// obj = Workplane("XY").newObject([box1.val(), box2.val()]).cut(shape_to_cut)
//   box1 = Workplane("XY").box(10, 20, 30); box2 = Workplane("YZ").box(10, 20, 30)
//   shape_to_cut = Workplane("XY").box(15, 15, 15).translate((8, 8, 8))
// Upstream cuts the COMPOUND as one boolean input: OCCT resolves the box1∩box2
// overlap into a partition of 4 touching solids (verified live, vols
// 3572.5 / 1807.625 / 2000 / 1572.5, sum 8952.625):
//   p2 = box1−box2−tool (square-tube remainder)  p4 = (box1∩box2)−tool
//   p5 = box2 left arm (x<−5) − tool             p6 = box2 right arm − tool.
// cq-compat cut() does not accept a compound base (no-op, verified), so the
// mirror builds the four partition pieces with existing ops — same point sets
// per piece — and bundles them with compound() as the result (same pattern as
// test_history_bool__res2; intermediate Shape lets consumed by the compound do
// not become CLI terminals, so the export stays a single .step file).
// ref (cadquery 2.8.0): Compound, vol 8952.625, bbox [-15,-10,-15]..[15,10,15]
import * as cq from '@faicad/cq-compat'
let box1 = await cq.box(cq.Workplane('XY'), 10, 20, 30)
let box2 = await cq.box(cq.Workplane('YZ'), 10, 20, 30)
let t0 = await cq.box(cq.Workplane('XY'), 15, 15, 15)
let tool = await cq.translate(t0, [8, 8, 8])
let a0 = await cq.box(cq.Workplane('XY'), 10, 10, 20)
let bL = await cq.translate(a0, [-10, 0, 0])
let bR = await cq.translate(a0, [10, 0, 0])
let p1 = await cq.cut(box1, cq.val(box2))
let p2 = await cq.cut(p1, cq.val(tool))
let p3 = await cq.intersect(box1, cq.val(box2))
let p4 = await cq.cut(p3, cq.val(tool))
let p5 = await cq.cut(bL, cq.val(tool))
let p6 = await cq.cut(bR, cq.val(tool))
let result = cq.compound(cq.val(p2), cq.val(p4), cq.val(p5), cq.val(p6))
