// source: test_cadquery.py::TestCadQuery::testUnionCompound (var shape_to_cut)
// shape_to_cut = Workplane("XY").box(15, 15, 15).translate((8, 8, 8))
// ref (cadquery 2.8.0): Solid, vol 3375, centred (8, 8, 8)
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane('XY'), 15, 15, 15)
let shape_to_cut = await cq.translate(b, [8, 8, 8])
let result = cq.val(shape_to_cut)
