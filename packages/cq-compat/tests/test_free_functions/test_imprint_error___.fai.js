// source: test_free_functions.py::test_imprint_error (unnamed exported var)
// imprint(b1, b2, history=...) raises internally; the harness snapshots locals
// at function exit, so the unnamed var is the imprint input bundle = Compound
// of b1 and b2 (touching solids, ref probe: vol 2, 12 faces, x [-0.5,1.5]).
// History bookkeeping is not STEP-observable; bundle replicated with the
// module-level compound() free function.
import * as cq from '@faicad/cq-compat'
let b1 = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let b2 = await cq.moved(b1, cq.Location([1, 0, 0]))
let bundle = cq.compound(cq.val(b1), cq.val(b2))
let result = bundle
