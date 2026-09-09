// source: test_cadquery.py::TestCadQuery::testUnionCompound (var box2)
// box2 = Workplane("YZ").box(10, 20, 30)
// On the YZ plane w=10 runs along y, d=20 along z, h=30 along x.
// ref (cadquery 2.8.0): Solid, vol 6000, bbox [-15,-5,-10]..[15,5,10]
import * as cq from '@faicad/cq-compat'
let box2 = await cq.box(cq.Workplane('YZ'), 10, 20, 30)
let result = cq.val(box2)
