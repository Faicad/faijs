#! /usr/bin/env python3
"""probe-sprocket-chamfer.py — 平齿倒角的边选择与体积归因（W7）。

问题：`edges(RadiusNthSelector(2)).chamfer(0.25t, 0.5t)` 的 64 张 CONE 面
是否 = 顶圈 32 + 底圈 32？体积差应 ≈ 2 × (三角形面积 × 弧长积分)。
用「只倒顶圈 / 只倒底圈」两个对照实验拆分归因。
"""
import math
import os
import sys

sys.path.insert(0, os.environ.get("FAI_CQ_UPSTREAM", r"C:\git\CADQ\cq_warehouse\src"))

import cadquery as cq  # noqa: E402
from cq_warehouse.sprocket import Sprocket  # noqa: E402

T = 2.1336
sp = (
    cq.Workplane("XY")
    .polarArray(Sprocket.sprocket_pitch_radius(32, 12.7), 0, 360, 32)
    .tooth_outline(32, 12.7, 7.9375, 0.0)
    .consolidateWires()
    .rotate((0, 0, 0), (0, 0, 1), 90)
    .extrude(T)
)
v0 = sp.val().Volume()

sel = sp.edges(cq.selectors.RadiusNthSelector(2)).vals()
print(f"selected edges: {len(sel)}")
census = {}
for e in sel:
    key = (round(e.radius(), 5), round(e.Center().z, 4))
    census[key] = census.get(key, 0) + 1
print(f"(radius, z_center) census: {census}")

top_edges = [e for e in sel if e.Center().z > T / 2]
bot_edges = [e for e in sel if e.Center().z <= T / 2]
print(f"top={len(top_edges)} bottom={len(bot_edges)}")

ch_top = sp.newObject(
    [sp.val().chamfer(T * 0.25, T * 0.5, top_edges)]
).val().Volume() if False else None
# cq Solid.chamfer(length, length2, edgeList) 直接可用
solid = sp.val()
v_top = solid.chamfer(T * 0.25, T * 0.5, top_edges).Volume()
v_bot = solid.chamfer(T * 0.25, T * 0.5, bot_edges).Volume()
print(f"unchamfered        = {v0:.9f}")
print(f"top-only chamfered = {v_top:.9f}  diff={v0 - v_top:.6f}")
print(f"bot-only chamfered = {v_bot:.9f}  diff={v0 - v_bot:.6f}")
print(f"both (probe ref)   = 27006.314090075  diff=78.324230")

# 理论值：三角形 ½·d1·d2，质心半径 R−d1/3
R = 66.76896245735234
d1, d2 = T * 0.25, T * 0.5
A = 0.5 * d1 * d2
import cadquery as cq2  # 拿弧长
arc_len_top = sum(e.Length() for e in top_edges)
print(f"theory top diff = {A * (R - d1 / 3) * arc_len_top:.6f} (arc_len={arc_len_top:.4f})")
