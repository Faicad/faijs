// source: test_cadquery.py::TestCadQuery::test_MergeTags (var b)
// b = Workplane(origin=(1, 0, 0)).box(1, 1, 2).faces(">Z").workplane()
//      .tag("zface").end(2)
// (the tag/end asserts are non-geometry; only the box is compared)
// ref anchor: vol=2, bbox x[0.5,1.5] y±0.5 z[-1,1], topo f6/e12/v8/s1
import * as cq from '@faicad/cq-compat'
let wp0 = await cq.translate(cq.Workplane(), [1, 0, 0])
let b = await cq.box(wp0, 1, 1, 2)
let result = cq.val(b)
