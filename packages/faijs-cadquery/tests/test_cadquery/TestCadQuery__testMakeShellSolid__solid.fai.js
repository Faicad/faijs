// source: test_cadquery.py::TestCadQuery::testMakeShellSolid (var solid)
// vertices = [[c0,-c0,c0],[c0,c0,-c0],[-c0,c0,c0],[-c0,-c0,-c0]], c0 = √2/4
// faces_ixs = [[0,1,2,0],[1,0,3,1],[2,3,0,2],[3,2,1,3]]
//   -> Edge.makeLine rings -> Wire.combine -> Face.makeFromWires
//   -> Shell.makeShell -> Solid.makeSolid  (unit-edge regular tetrahedron)
// NOTE: solidFromFaces' FIRST argument is the frame workplane, NOT a face —
// passing f1 there silently drops it from the sew (3 faces, vol √2/18);
// all four faces go in the faces array (probed 2026-10-01).
// ref anchor: vol=0.117851130198 (= √2/12), bbox ±√2/4, topo f4/e6/v4/s1
import * as cq from '@faicad/faijs-cadquery'
let c0 = Math.sqrt(2) / 4
let v0 = [c0, -c0, c0]
let v1 = [c0, c0, -c0]
let v2 = [-c0, c0, c0]
let v3 = [-c0, -c0, -c0]
let f1 = await cq.faceFromPoints(cq.Workplane(), [v0, v1, v2])
let f2 = await cq.faceFromPoints(cq.Workplane(), [v1, v0, v3])
let f3 = await cq.faceFromPoints(cq.Workplane(), [v2, v3, v0])
let f4 = await cq.faceFromPoints(cq.Workplane(), [v3, v2, v1])
let solid = await cq.solidFromFaces(cq.Workplane(), [f1, f2, f3, f4])
let result = cq.val(solid)
