// source: test_shapes.py::test_single_ent_selector (var fs)
// fs = bs.faces(">Z")   (module-level Shape.faces — a COMPOUND OF FACES,
//                        unlike Workplane.faces() which only records a selection)
// bs = box(1,1,1).moved((0,0,0),(2,0,0)) — free-function box (z in [0,1]),
// so the two top faces sit at z=1, centres x=0 and x=2.
// ref (cadquery 2.8.0): Compound, area 2.
import * as cq from '@faicad/cq-compat'
let b0 = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let bs = cq.moved(b0, cq.Location(), cq.Location([2, 0, 0]))
let fs = await cq.faceCompound(bs, '>Z')
let result = cq.val(fs)
