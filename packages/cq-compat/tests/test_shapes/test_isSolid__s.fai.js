// source: test_shapes.py::test_isSolid (var s)
// s = box(1, 1, 1)   (module-level free function)
// func.box is xy-centred and sits on z=0 (z 0..1) — hence centered:[true,true,false].
// ref (cadquery 2.8.0): Solid, vol 1
import * as cq from '@faicad/cq-compat'
let s = await cq.box(cq.Workplane(), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(s)
