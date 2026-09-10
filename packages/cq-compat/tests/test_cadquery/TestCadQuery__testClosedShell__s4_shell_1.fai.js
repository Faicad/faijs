// source: test_cadquery.py::TestCadQuery::testClosedShell (var s4_shell_1)
// s4_shape = Workplane("XY").box(2, 2, 2).val()
// s4_shell_1 = s4_shape.hollow(faceList=None, thickness=-0.1)
// hollow with no faces removed == closed shell inward — same result as s1.
// ref (probed): vol 2.168.
import * as cq from '@faicad/cq-compat'
let b = await cq.box(cq.Workplane('XY'), 2, 2, 2)
let s4_shell_1 = await cq.shell(b, -0.1)
let result = cq.val(s4_shell_1)
