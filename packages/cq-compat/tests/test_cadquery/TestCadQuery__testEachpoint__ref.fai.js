// source: test_cadquery.py::TestCadQuery::testEachpoint (var ref)
// ref = Workplane("XY").box(10, 10, 1)  (the eachpoint target base; the saved
// ref is the plain base box — only the box geometry is exported)
// ref anchor: vol=100, bbox ±5 × z±0.5, topo f6/e12/v8/s1
import * as cq from '@faicad/cq-compat'
let ref = await cq.box(cq.Workplane(), 10, 10, 1)
let result = cq.val(ref)
