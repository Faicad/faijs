// source: test_cadquery.py::TestCadQuery::testClean (var s — LAST assignment)
// s = Workplane().sphere(1).wedge(0.5, 4, 4, 0, 0, 0.5, 4, clean=True)
// Upstream quirk measured (cadquery 2.8.0): the kernel unify pass on this
// union REMOVES volume — clean=True vol 9.07992181465731 vs clean=False
// 10.650718133126762. cq-compat cleanShapes uses the same OCCT
// UnifySameDomain semantics, so the quirk reproduces exactly.
// ref (probed): vol 9.07992181465731.
import * as cq from '@faicad/cq-compat'
let s = await cq.sphere(cq.Workplane(), 1)
let s2 = await cq.wedge(s, 0.5, 4, 4, 0, 0, 0.5, 4)
let result = cq.val(s2)
