// source: test_cadquery.py::test_extrude_face (var c)
// f = face(rect(1, 1)); c = compound(f)
// rect free function: xy-centred wire on z=0 -> one 1x1 planar face at z=0.
// Reproduced as the compound of the free-function box's BOTTOM face ('<Z'),
// which is the same 1x1 face at z=0.
// ref (cadquery 2.8.0): Compound, vol/area 1
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let c = await cq.faceCompound(b, '<Z')
let result = cq.val(c)
