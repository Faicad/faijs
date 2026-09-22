// source: test_shapes.py::test_single_ent_selector (var fs)
// bs = box(1,1,1).moved((0,0,0),(2,0,0)); fs = bs.faces(">Z") — the compound
// of BOTH top faces (tie at the >Z extremum).
import * as cq from '@faicad/cq-compat'
let w0 = cq.Workplane('XY')
let b1 = await cq.box(w0, 1, 1, 1, { centered: [true, true, false] })
let bs = await cq.moved(b1, { x: 0 }, { x: 2 })
let fs = await cq.faceCompound(bs, '>Z')
let result = cq.val(fs)
