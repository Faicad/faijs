"""probe-bradtee-decomposition.py — A 侧：逐步拆解上游 `BradTeeNut.custom_make`
的 `clearanceHole(fastener=CounterSunkScrew(...))` 切割量。

为什么保留（不是一次性脚本）：`src/recess.ts` 的 `tempClearanceHoleCutter` 复刻了上游
`extensions._fastenerHole` 的 cutter 组装（沉头截锥 ∪ 杆部圆柱 ∪ 82° 钻尖），而
`CounterSunkScrew.countersink_profile` 是 **90° 截锥**（不是矩形）—— 这两点无法从 TS 侧
自证。本脚本从上游 Python 打印出每一段的顶点与体积，供 W9·P1-b 落地
`src/holes.ts` 时逐位对照（方案 §8-W4 去重表：P1-b 必须替换 W4 的临时实现）。

结论已转正为断言：`src/nut.test.ts`（BradTeeNut 体积 3389.175287 / 法兰 36.3×36.3×16.5
/ 孔位 12,-6±10.392304845）；偏差裁决见
`docs/analysis/2026-09-14-cq-warehouse-nut-washer-probe.md` §3。

运行（需 cadquery venv + 上游 clone）：
    cd C:/git/CADQ/cq_warehouse
    PYTHONPATH=src C:/Users/ylt/cadquery-env/Scripts/python.exe \
        <repo>/packages/fai_cq_warehouse/scripts/probe-bradtee-decomposition.py

⚠️ 只打印、不 assert —— 证据生成器；断言在测试里。
"""

import math

import cadquery as cq
from cq_warehouse.fastener import BradTeeNut, CounterSunkScrew
import cq_warehouse.extensions  # noqa: F401  （monkey-patch clearanceHole）

n = BradTeeNut(size="M6-1", fastener_type="Hilitchi")
d = n.nut_data
print("nut_data:", dict(d))

brad = CounterSunkScrew(size=d["brad_size"], length=2 * d["c"], fastener_type="iso10642")
fit = "Normal"
# ① 沉头轮廓是 90° 截锥：(0,0) → (0,k) → (dk/2,k) → (dk/2 − k·tan(a/2), 0)
csk = brad.countersink_profile(fit)
vt = csk.toPending().vertices().vals()
print("csk vertices:", [(round(v.X, 6), round(v.Y, 6), round(v.Z, 6)) for v in vt])
print("csk bbox xlen/zlen:", csk.val().BoundingBox().xlen, csk.val().BoundingBox().zlen)

csr = csk.revolve().val()
print("csk.revolve bbox:", csr.BoundingBox().xlen, csr.BoundingBox().zlen, "vol:", csr.Volume())

base = n.make_nut().val()
print("base vol:", base.Volume())

# ② 手工复刻 _fastenerHole 的 cutter 组装
hole_diameters = brad.clearance_hole_diameters
hole_radius = hole_diameters[fit] / 2
head_offset = csk.vertices(">Z").val().Z
print("hole_radius:", hole_radius, "head_offset:", head_offset)

workplane = n.make_nut().faces(">Z").workplane()
depth = workplane.largestDimension()
print("depth (largestDimension):", depth)
print("val bbox:", workplane.val().BoundingBox().xlen, workplane.val().BoundingBox().zlen)

bore = cq.Vector(0, 0, -1)
origin = cq.Vector(0, 0, 0)
shank_hole = cq.Solid.makeCylinder(radius=hole_radius, height=depth, pnt=origin, dir=bore)
print("shank vol:", shank_hole.Volume())

csk_cutter = csk.revolve().translate((0, 0, -head_offset)).val()
print("csk_cutter vol:", csk_cutter.Volume())

fused = csk_cutter.fuse(shank_hole)
print("csk+shank vol:", fused.Volume())

cskAngle = 82
h = hole_radius / math.tan(math.radians(cskAngle / 2.0))
drill_tip = cq.Solid.makeCone(hole_radius, 0.0, h, bore * depth, bore)
print("drill_tip vol:", drill_tip.Volume())
fastener_hole = fused.fuse(drill_tip)
print("cutter vol (all):", fastener_hole.Volume())

out = workplane.cutEach(lambda loc: fastener_hole.moved(loc), True, False)
print("after cutEach vol:", out.val().Volume())

final = n.val()
print("FINAL vol:", final.Volume())
print("removed total:", base.Volume() - final.Volume())
