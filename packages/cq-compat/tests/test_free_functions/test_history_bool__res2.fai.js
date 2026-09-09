// source: test_free_functions.py::test_history_bool (var res2)
// res2 = imprint(res, b2): bundles the base solid and the tool solid into one
// Compound (ref vol 1.0 = res 0.95 + b2 0.05). Reproduced geometrically with
// the module-level compound() free function — History/imprint bookkeeping is
// not exported by the mirror harness.
// ref (cadquery 2.8.0): Compound (2 solids), vol 1
import * as cq from '@faicad/cq-compat'
let b0 = await cq.box(cq.Workplane('XY'), 1, 1, 1)
let b1 = await cq.translate(b0, [0, 0, 0.5])
let t0 = await cq.box(cq.Workplane('XY'), 1, 0.5, 0.1)
let b2 = await cq.translate(t0, [0, 0, 0.05])
let res = await cq.cut(b1, b2)
let res2 = cq.compound(cq.val(res), cq.val(b2))
let result = res2
