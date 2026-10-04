// source: test_free_functions.py::test_sweep (var r8)
// r8 = sweep(face(rect(1,1)), spline((f1.Center(), f2.Center()),
//            ((0,0,1),(1,0,0)))) — simplest face sweep (no inner wires):
// a 1x1 square swept along the 3-D spline (0,0,0)->(2,0,2).
// For a face profile CadQuery sweeps its OUTER wire: `Solid.sweep(face, path)`
// → `builder.Add(face.outerWire())` (shapes.py:4661). So the wire-level sweep
// below is exactly equivalent (no holes to subtract).
// ref (cadquery 2.8.0): vol 3.246429, 6 faces, bb x[-0.5,2] y[-0.5,0.5] z[0,2.5]
import * as cq from '@faicad/faijs-cadquery'
let w0 = cq.Workplane('XY')
let w1 = cq.rect(w0, 1, 1)
let p3 = cq.splineWire3D([[0, 0, 0], [2, 0, 2]], [[0, 0, 1], [1, 0, 0]])
let r8 = await cq.sweep(w1, p3)
let result = cq.val(r8)
