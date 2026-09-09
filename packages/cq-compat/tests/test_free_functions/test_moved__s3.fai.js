// source: test_free_functions.py::test_moved (var s3)
// ref (cadquery 2.8.0): vol 0.004189, 8 faces, com (0,0,0.5)
//   s3 = s.moved(b.vertices())  -> 8 spheres at the 8 corners
// NOTE: upstream derives these locations from `b.faces()` / `b.edges('|Z')` /
// `b.vertices()` via Shape.toLocs() (face uv-centre + frame, edge midpoint +
// frame, else Center()). cq-compat has no sub-shape enumeration yet, so the
// centres measured in cadquery 2.8.0 are inlined verbatim.
import * as cq from '@faicad/cq-compat'
let wp0 = cq.Workplane('XY')
// func.box(1,1,1) is xy-centred and sits on z=0 (z 0..1) - cq.box is centred on
// the workplane origin, so lift it by half the height to match.
let b0 = await cq.box(wp0, 1, 1, 1)
let b = await cq.translate(b0, [0, 0, 0.5])
// func.sphere(d) takes the DIAMETER: sphere(0.1) -> radius 0.05 (vol 0.000524).
let sp = await cq.sphere(wp0, 0.05)
let s3 = await cq.moved(sp, [cq.Location([-0.5, -0.5, 1]), cq.Location([-0.5, -0.5, 0]), cq.Location([-0.5, 0.5, 1]), cq.Location([-0.5, 0.5, 0]), cq.Location([0.5, -0.5, 1]), cq.Location([0.5, -0.5, 0]), cq.Location([0.5, 0.5, 1]), cq.Location([0.5, 0.5, 0])])
let result = cq.val(s3)
