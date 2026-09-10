// source: test_cadquery.py::TestCadQuery::testNoClean (var s — LAST assignment)
// s = Workplane().sphere(1).wedge(0.5, 4, 4, 0, 0, 0.5, 4, clean=False)
// clean=False keeps the boolean splitter faces: vol 10.650718133126762
// (sphere + box(0.5,4,4) - lens overlap; the cleaned shape is 9.079922).
// ref (probed): vol 10.650718133126762.
import * as cq from '@faicad/cq-compat'
let s = await cq.sphere(cq.Workplane(), 1)
let s2 = await cq.wedge(s, 0.5, 4, 4, 0, 0, 0.5, 4, { clean: false })
let result = cq.val(s2)
