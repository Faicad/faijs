#! /usr/bin/env python3
"""probe-sprocket-outline.py — A 侧边序列探针（W7，照 probe-screw-head-profiles.py 先例）。

回答三个问题（B 侧 sprocket.ts 复刻的依据）：
  1. polarArray + tooth_outline + consolidateWires 后的 outline wire 到底由哪些边
     组成（每条边的类型 / 半径 / 圆心 / 起终点）——特别是相邻齿共享的 roller
     pocket 弧是补齐还是重复。
  2. 平齿（flat）变体 chamfer(0.25t, 0.5t) 后圆锥面的实际几何：径向/轴向距离
     各是多少（判定 cq Add(d1,d2,E,F) 的 F 落在哪一面）。
  3. spiky 变体的边数与半径集合（无顶弧 → 2 个唯一半径）。
"""
import math
import os
import sys

sys.path.insert(0, os.environ.get("FAI_CQ_UPSTREAM", r"C:\git\CADQ\cq_warehouse\src"))

import cadquery as cq  # noqa: E402
from cq_warehouse.sprocket import Sprocket, make_tooth_outline  # noqa: E402


def edge_info(e):
    t = e.geomType()
    out = {"type": t, "start": tuple(round(v, 6) for v in e.startPoint().toTuple()),
           "end": tuple(round(v, 6) for v in e.endPoint().toTuple())}
    if t == "CIRCLE":
        c = e.arcCenter()
        out["radius"] = round(e.radius(), 7)
        out["center"] = tuple(round(v, 6) for v in c.toTuple())
    return out


def dump_outline(tag, num_teeth, chain_pitch, roller_diameter):
    wire_wp = (
        cq.Workplane("XY")
        .polarArray(Sprocket.sprocket_pitch_radius(num_teeth, chain_pitch), 0, 360, num_teeth)
        .tooth_outline(num_teeth, chain_pitch, roller_diameter, 0.0)
        .consolidateWires()
        .rotate((0, 0, 0), (0, 0, 1), 90)
    )
    wires = wire_wp.vals()
    print(f"== {tag}: consolidated vals={len(wires)}")
    for w in wires:
        edges = w.Edges()
        print(f"   wire closed={w.IsClosed()} edges={len(edges)}")
        for i, e in enumerate(edges):
            print(f"   e[{i}] {edge_info(e)}")


def dump_chamfer(tag, num_teeth, chain_pitch, roller_diameter):
    sp = (
        cq.Workplane("XY")
        .polarArray(Sprocket.sprocket_pitch_radius(num_teeth, chain_pitch), 0, 360, num_teeth)
        .tooth_outline(num_teeth, chain_pitch, roller_diameter, 0.0)
        .consolidateWires()
        .rotate((0, 0, 0), (0, 0, 1), 90)
        .extrude(2.1336)
    )
    arc_list = {round(a.radius(), 7) for a in sp.edges("%circle").vals()}
    print(f"== {tag}: circle radii after extrude = {sorted(arc_list)} (flat={len(arc_list) == 3})")
    if len(arc_list) != 3:
        return
    ch = sp.edges(cq.selectors.RadiusNthSelector(2)).chamfer(2.1336 * 0.25, 2.1336 * 0.5)
    ch_solid = ch.val()
    print(f"   chamfered volume={ch_solid.Volume():.9f} (unchamfered={sp.val().Volume():.9f})")
    # 圆锥面采样：拿锥面上两个点反推径向/轴向距离
    for f in ch_solid.Faces():
        if f.geomType() == "CONE":
            u0, u1, v0, v1 = f._uvBounds()
            pts = []
            for v in (v0 + 0.25 * (v1 - v0), v0 + 0.75 * (v1 - v0)):
                p = f.positionAt(u0 + 0.5 * (u1 - u0), v)
                rr = math.hypot(p.x, p.y)
                pts.append((round(rr, 6), round(p.z, 6)))
            print(f"   cone face samples (r,z): {pts}")
            break


dump_outline("flat-16T", 16, 12.7, 7.9375)
dump_chamfer("flat-32T", 32, 12.7, 7.9375)
dump_outline("spiky-16T", 16, 12.7, 12.446)

# ── 追加：平齿倒角的 CONE 面数量（判定上下两圈是否都倒角）──
import collections
sp2 = (
    cq.Workplane("XY")
    .polarArray(Sprocket.sprocket_pitch_radius(32, 12.7), 0, 360, 32)
    .tooth_outline(32, 12.7, 7.9375, 0.0)
    .consolidateWires()
    .rotate((0, 0, 0), (0, 0, 1), 90)
    .extrude(2.1336)
)
ch2 = sp2.edges(cq.selectors.RadiusNthSelector(2)).chamfer(2.1336 * 0.25, 2.1336 * 0.5).val()
kinds = collections.Counter(f.geomType() for f in ch2.Faces())
print(f"== chamfer face kinds (32T flat): {dict(kinds)}")
cones = [f for f in ch2.Faces() if f.geomType() == "CONE"]
if cones:
    f0 = cones[0]
    u0, u1, v0, v1 = f0._uvBounds()
    p = f0.positionAt(0.5, v0 + 0.5 * (v1 - v0))
    print(f"   cone count={len(cones)}, sample r={math.hypot(p.x, p.y):.6f} z={p.z:.6f}")
# 底圈是否也倒了：看 z<0.2 处的外径
import numpy  # noqa
