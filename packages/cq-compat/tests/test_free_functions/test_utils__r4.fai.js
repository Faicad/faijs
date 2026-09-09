// source: test_free_functions.py::test_utils (var r4)
// r4 = _get_one(compound(box(1, 1, 1), box(2, 2, 2)), "Solid")
// _get_one is a PRIVATE occ_impl.shapes utility (not part of the public
// CadQuery API cq-compat replicates): given a Compound it returns the FIRST
// sub-shape matching the requested type — here the 1x1x1 box. The exported
// value is therefore exactly that box.
// ref (cadquery 2.8.0): Solid, vol 1
import * as cq from '@faicad/cq-compat'
let r4 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(r4)
