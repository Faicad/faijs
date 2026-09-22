// source: test_selectors.py::TestCQSelectors::testCenterNthSelector (var prism)
// prism = Workplane().rect(2,2).extrude(1, taper=30) — tapered prism; CenterNth edge picks in-process.
import * as cq from '@faicad/cq-compat'
let prism = await cq.extrude(cq.rect(cq.Workplane(), 2, 2), 1, true, { taper: 30 })
let result = cq.val(prism)
