"""probe-screw-head-profiles.py — A 侧：逐位 dump 上游 12 类 `Screw` 子类的头型
轮廓（`head_profile` / `head_plan` / `flange_profile` / `head_recess`）。

为什么保留（不是一次性脚本）：`src/screw.ts` 用纯 2D 点算术复刻 cq 的
`polarLine` / `radiusArc` / `fillet2D` / `spline` 组合，其中三处**无法从 TS 侧自证**：

  1. `CheeseHeadScrew.head_profile` 写的是 `polarLine(k/cos(degrees(5)), 5-90)`
     —— `degrees(5)` 的单位怪癖使实际长度 = `k/cos(5°)`，且方向朝下（局部 −y）；
  2. `fillet2D(r, vertices("<X 极值顶点"))` 的切点落位；
  3. `PanHeadScrew.head_profile` 的 `spline(tangents=…, includeCurrent=True)` 走的是
     `GeomAPI_Interpolate(scale=True)` 插值路径。

本脚本把这些量从上游 Python 打印出来，供实现时逐位对照；结论已转正为断言：
`src/screw.test.ts`（头型几何回归锁）与 `src/kernel-conformance.test.ts`
（`interpolatePointsWithTangents` 极点对表）。

运行（需 cadquery venv + 上游 clone）：
    cd C:/git/CADQ/cq_warehouse
    PYTHONPATH=src C:/Users/ylt/cadquery-env/Scripts/python.exe \
        <repo>/packages/fai_cq_warehouse/scripts/probe-screw-head-profiles.py [类名片段]

⚠️ 只打印、不 assert —— 证据生成器；断言在测试里。
"""

import math
import sys

import cadquery as cq

from cq_warehouse.fastener import (
    ButtonHeadScrew,
    ButtonHeadWithCollarScrew,
    CheeseHeadScrew,
    CounterSunkScrew,
    HexHeadScrew,
    HexHeadWithFlangeScrew,
    PanHeadScrew,
    PanHeadWithCollarScrew,
    RaisedCheeseHeadScrew,
    RaisedCounterSunkOvalHeadScrew,
    SetScrew,
    SocketHeadCapScrew,
)


def fmt(v):
    return f"({v.x:.6f},{v.y:.6f},{v.z:.6f})"


def dump_edges(label, wp):
    """按序打印 wire 的边：geomType / start / end / mid / radius。"""
    wire = wp.val()
    print(f"  {label}: {len(wire.Edges())} edges")
    for i, e in enumerate(wire.Edges()):
        gt = e.geomType()
        s = e.startPoint()
        t = e.endPoint()
        mid = e.positionAt(0.5)
        if gt == "LINE":
            print(f"    #{i} LINE {fmt(s)} -> {fmt(t)}")
        elif gt == "CIRCLE":
            print(f"    #{i} {gt} {fmt(s)} -> {fmt(t)} r={e.radius():.9f} mid={fmt(mid)}")
        else:
            # BSPLINE 等：radius() 会抛 "Shape could not be reduced to a circle"；
            # 打极点供 kernel-conformance 的 interpolatePointsWithTangents 对表。
            try:
                poles = [p.toTuple() for p in e.getNurbsCurveData().poles]
            except Exception:  # noqa: BLE001
                poles = []
            print(f"    #{i} {gt} {fmt(s)} -> {fmt(t)} mid={fmt(mid)}")
            for j, p in enumerate(poles):
                print(f"       pole{j}: ({p[0]:.9f},{p[1]:.9f},{p[2]:.9f})")


def dump_case(cls, **kwargs):
    print(f"=== {cls.__name__} {kwargs} ===")
    s = cls(**kwargs)
    d = s.screw_data
    print(f"  screw_data: {{{', '.join(f'{k}={v!r}' for k, v in d.items())}}}")
    print(f"  head_height={s.head_height!r} head_diameter={s.head_diameter!r}")
    print(f"  length_offset={s.length_offset()!r}")
    try:
        print(f"  min_hole_depth={s.min_hole_depth()!r}")
    except Exception as exc:  # noqa: BLE001
        print(f"  min_hole_depth THROW {type(exc).__name__}: {exc}")
    print(f"  max_thread_length={s.max_thread_length!r} thread_length={s.thread_length!r}")

    if hasattr(type(s), "head_profile") and "head_profile" in type(s).__dict__:
        dump_edges("head_profile", s.head_profile())
    if "head_plan" in type(s).__dict__:
        dump_edges("head_plan", s.head_plan())
    if "flange_profile" in type(s).__dict__:
        dump_edges("flange_profile", s.flange_profile())
    if "head_recess" in type(s).__dict__:
        try:
            (plan, depth, taper) = s.head_recess()
            dump_edges("head_recess plan", plan)
            print(f"  head_recess depth={depth!r} taper={taper!r}")
        except Exception as exc:  # noqa: BLE001
            print(f"  head_recess THROW {type(exc).__name__}: {exc}")
    # Screw 是 Solid 子类但无 val()；直接用 Shape 的 BoundingBox()/Volume()。
    bb = s.BoundingBox()
    print(
        f"  SOLID bbox x=[{bb.xmin:.9f},{bb.xmax:.9f}] y=[{bb.ymin:.9f},{bb.ymax:.9f}]"
        f" z=[{bb.zmin:.9f},{bb.zmax:.9f}] vol={s.Volume():.9f}"
    )

    csk = None
    try:
        csk = s.countersink_profile("Normal")
    except Exception as exc:  # noqa: BLE001
        print(f"  countersink_profile THROW {type(exc).__name__}: {exc}")
    if csk is None:
        print("  countersink_profile: None（SetScrew：无头）")
    else:
        dump_edges("countersink_profile(Normal)", csk)
    print()


def dump_cross_cutter(size="PH3", depth=None, taper=30):
    """PH（cross）沉孔切割器的 A 侧形态——W5 显式缺口的证据（我们的 draftPrism 自交即抛错）。

    ⚠️ `cross_recess` 返回的是 **`(plan, depth)` 元组**（`slot_recess`/`hex_recess` 同款），
    不是 Workplane。
    """
    from cq_warehouse.fastener import cross_recess  # type: ignore

    plan, plan_depth = cross_recess(size)
    if depth is None:
        depth = plan_depth
    cutter = cq.Solid.extrudeLinear(plan.val(), [], cq.Vector(0, 0, -depth), taper=taper)
    bb = cutter.BoundingBox()
    print(f"=== cross cutter {size} depth={depth} taper={taper} ===")
    print(
        f"  bbox x=[{bb.xmin:.6f},{bb.xmax:.6f}] z=[{bb.zmin:.6f},{bb.zmax:.6f}]"
        f" vol={cutter.Volume():.9f} faces={len(cutter.Faces())}"
    )
    for i, f in enumerate(cutter.Faces()):
        fb = f.BoundingBox()
        print(
            f"    face#{i} {f.geomType()} area={f.Area():.6f}"
            f" z=[{fb.zmin:.6f},{fb.zmax:.6f}]"
        )
    print()


CASES = [
    (ButtonHeadScrew, dict(size="M6-1", length=16, fastener_type="iso7380_1")),
    (ButtonHeadScrew, dict(size="M4-0.7", length=12, fastener_type="iso7380_1")),
    (ButtonHeadWithCollarScrew, dict(size="M6-1", length=16, fastener_type="iso7380_2")),
    (ButtonHeadWithCollarScrew, dict(size="M4-0.7", length=12, fastener_type="iso7380_2")),
    (CheeseHeadScrew, dict(size="M6-1", length=25, fastener_type="iso1207")),
    (CheeseHeadScrew, dict(size="M4-0.7", length=16, fastener_type="iso1207")),
    (CheeseHeadScrew, dict(size="M6-1", length=25, fastener_type="iso14580")),
    (CounterSunkScrew, dict(size="M6-1", length=20, fastener_type="iso10642")),
    (CounterSunkScrew, dict(size="M4-0.7", length=16, fastener_type="iso10642")),
    (CounterSunkScrew, dict(size="M6-1", length=20, fastener_type="iso2009")),
    (CounterSunkScrew, dict(size="M6-1", length=20, fastener_type="iso14582")),
    (HexHeadScrew, dict(size="M6-1", length=30, fastener_type="iso4017")),
    (HexHeadScrew, dict(size="M4-0.7", length=20, fastener_type="iso4017")),
    (HexHeadWithFlangeScrew, dict(size="M6-1", length=25, fastener_type="din1665")),
    (HexHeadWithFlangeScrew, dict(size="M8-1.25", length=30, fastener_type="din1665")),
    (PanHeadScrew, dict(size="M6-1", length=20, fastener_type="iso1580")),
    (PanHeadScrew, dict(size="M4-0.7", length=16, fastener_type="iso1580")),
    (PanHeadScrew, dict(size="M6-1", length=20, fastener_type="iso14583")),
    (RaisedCounterSunkOvalHeadScrew, dict(size="M6-1", length=20, fastener_type="iso2010")),
    (RaisedCounterSunkOvalHeadScrew, dict(size="M4-0.7", length=16, fastener_type="iso2010")),
    (RaisedCounterSunkOvalHeadScrew, dict(size="M6-1", length=20, fastener_type="iso14584")),
    (SetScrew, dict(size="M6-1", length=12, fastener_type="iso4026")),
    (SetScrew, dict(size="M8-1.25", length=16, fastener_type="iso4026")),
    (SocketHeadCapScrew, dict(size="M6-1", length=25, fastener_type="iso4762")),
    (SocketHeadCapScrew, dict(size="M4-0.7", length=16, fastener_type="iso4762")),
    (SocketHeadCapScrew, dict(size="M6-1", length=25, fastener_type="iso4762", simple=False)),
    (PanHeadWithCollarScrew, dict(size="M6-1", length=16, fastener_type="din967")),
    (RaisedCheeseHeadScrew, dict(size="M6-1", length=20, fastener_type="iso7045")),
]

FILTER = sys.argv[1] if len(sys.argv) > 1 else None

print(f"# math.degrees(5) = {math.degrees(5)!r}  cos(degrees(5)) = {math.cos(math.degrees(5))!r}")
print(f"# 但实测 polarLine 长度对应 cos(radians(5)) = {math.cos(math.radians(5))!r}")
print()

if FILTER and FILTER.lower() == "cross":
    dump_cross_cutter("PH2")
    dump_cross_cutter("PH3")
    sys.exit(0)

for cls, kwargs in CASES:
    if FILTER and FILTER.lower() not in cls.__name__.lower():
        continue
    try:
        dump_case(cls, **kwargs)
    except Exception as exc:  # noqa: BLE001
        print(f"=== {cls.__name__} {kwargs} === THROW {type(exc).__name__}: {exc}\n")
