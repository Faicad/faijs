// source: test_selectors.py::TestCQSelectors::testRadiusNthSelector (var solid)
// solid = makeUnitCube() — RadiusNthSelector key() raises in-process; exports unit cube.
import * as cq from '@faicad/faijs-cadquery'
let c = await cq.box(cq.Workplane('XY'), 1, 1, 1, { centered: [true, true, false] })
let result = cq.val(c)
