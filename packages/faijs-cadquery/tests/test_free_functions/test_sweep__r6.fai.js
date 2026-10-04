// source: test_free_functions.py::test_sweep (var r6)
// r6 = sweep(face(rect(1,1), circle(0.25)), p3) — face sweep WITH an inner wire.
// CadQuery's free sweep (shapes.py:7127) sweeps the face's outer wire, sweeps
// each inner wire, then assembles solid(outer_side, inner_side, top_with_hole,
// bot_with_hole) — i.e. outer pipe minus inner pipe. Expressed here as the
// equivalent boolean difference of the two capped pipes.
// ref (cadquery 2.8.0): vol 2.608988, 7 faces, bb x[-0.5,2] y[-0.5,0.5] z[0,2.5]
import * as cq from '@faicad/faijs-cadquery'
let p3 = cq.splineWire3D([[0, 0, 0], [2, 0, 2]], [[0, 0, 1], [1, 0, 0]])
let outer = await cq.sweep(cq.rect(cq.Workplane('XY'), 1, 1), p3)
let inner = await cq.sweep(cq.circle(cq.Workplane('XY'), 0.25), p3)
let r6 = await cq.cut(outer, inner)
let result = cq.val(r6)
