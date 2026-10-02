// source: test_cadquery.py::TestCadQuery::testFuzzyBoolOp (var box4_cmp)
// box4 = Workplane("XY", origin=(eps, 0, 0)).box(1, 1, 1)
// box4_cmp = Compound.makeCompound(box4.vals())
// ref anchor: vol=1, bbox x[-0.499,0.501], topo f6/e12/v8/s1
import * as cq from '@faicad/faijs-cadquery'
let moved = await cq.translate(cq.Workplane(), [0.001, 0, 0])
let box4 = await cq.box(moved, 1, 1, 1)
let box4_cmp = await cq.compound(cq.val(box4))
let result = cq.val(box4_cmp)
