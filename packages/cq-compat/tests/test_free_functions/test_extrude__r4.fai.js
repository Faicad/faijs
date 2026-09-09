// source: test_free_functions.py::test_extrude (var r4)
// f = fill(rect(1, 1)); r4 = extrude(f, (0, 0, 1))
// rect free function: xy-centred wire on z=0; fill -> planar face; extrude +1
// along +Z -> 1x1x1 box, z in [0,1]. rect+extrude on the workplane carrier
// produces the identical solid.
// ref (cadquery 2.8.0): Solid, vol 1
import * as cq from '@faicad/cq-compat'
let wp0 = cq.Workplane('XY')
let w = await cq.rect(wp0, 1, 1)
let r4 = await cq.extrude(w, 1)
let result = cq.val(r4)
