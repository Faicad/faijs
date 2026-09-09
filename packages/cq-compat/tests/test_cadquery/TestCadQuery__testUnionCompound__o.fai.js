// source: test_cadquery.py::TestCadQuery::testUnionCompound (var o)
// for o in box2.all(): ... — the SECOND loop reassigns o, so the final o is a
// single-solid wrapper of box2's solid (probe: bbox [-15,-5,-10]..[15,5,10] =
// box2's bbox, vol 6000).
// ref (cadquery 2.8.0): Solid, vol 6000
import * as cq from '@faicad/cq-compat'
let o = await cq.box(cq.Workplane('YZ'), 10, 20, 30)
let result = cq.val(o)
