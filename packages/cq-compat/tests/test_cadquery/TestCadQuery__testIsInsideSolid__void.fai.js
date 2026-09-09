// source: test_cadquery.py::TestCadQuery::testIsInsideSolid (var void)
// void = Workplane("XY").box(10, 10, 10)   -- "void" is a JS keyword, renamed
// ref (probed): vol 1000.000000, bbox [-5,5]^3.
import * as cq from '@faicad/cq-compat'
let voidBox = await cq.box(cq.Workplane('XY'), 10, 10, 10)
let result = cq.val(voidBox)
