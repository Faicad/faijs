// source: test_cadquery.py::TestCadQuery::testFuzzyBoolOp (var box1_cmp)
// box1 = Workplane("XY").box(1, 1, 1); box1_cmp = Compound.makeCompound(box1.vals())
// ref anchor: vol=1, bbox +/-0.5, topo f6/e12/v8/s1
import * as cq from '@faicad/cq-compat'
let box1 = await cq.box(cq.Workplane(), 1, 1, 1)
let box1_cmp = await cq.compound(cq.val(box1))
let result = cq.val(box1_cmp)
