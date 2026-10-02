// source: test_cadquery.py::TestCadQuery::testTagSelectors (var result0)
// result0 = Workplane("XY").box(1,1,1).tag("box").sphere(1)
// NOTE: faces/vertices/edges/wires(tag=...) counting is Python-side; the exported
// shape is the tagged box fused with the sphere (upstream faces().size()==1).
import * as cq from '@faicad/faijs-cadquery'
let wp0 = cq.Workplane('XY')
let wp1 = await cq.box(wp0, 1, 1, 1)
let tagged = cq.tag(wp1, 'box')
let result = await cq.sphere(tagged, 1)
let resultVal = cq.val(result)
