// source: test_cad_objects.py::TestCadObjects::testMatrixOfInertia (var cylinder)
// cylinder = Solid.makeCylinder(radius=1.0, height=2.0)
// CadQuery Solid.makeCylinder(radius, height) is axisymmetric in x/y (centred on
// the axis) and starts at the origin, i.e. x,y in [-1, 1] and z in [0, 2].
// NOTE: this differs from Workplane().cylinder(h, r, centered=False), which
// shifts x/y by +radius as well (verified vs cadquery 2.8.0) — so the mirror
// must pass [true, true, false], not plain false.
import * as cq from '@faicad/cq-compat'
let cylinder = await cq.cylinder(cq.Workplane('XY'), 2.0, 1.0, { centered: [true, true, false] })
let result = cq.val(cylinder)
