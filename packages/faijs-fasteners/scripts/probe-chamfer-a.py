#! /usr/bin/env python3
"""A 侧基准：圆环外顶圆非对称倒角（cq chamfer(d1,d2)），供 B 侧 chamferDistAngle 对照。"""
import math
import cadquery as cq

R, r, H = 10.0, 5.0, 2.0
d1, d2 = 0.5, 1.0  # 0.25t / 0.5t 比例同链轮（t=2）
ring = cq.Workplane("XY").circle(R).circle(r).extrude(H)
# 选外顶圆：radius == R 且 z == H
edge = [e for e in ring.edges("%CIRCLE").vals()
        if abs(e.radius() - R) < 1e-9 and abs(e.Center().z - H) < 1e-9]
print(f"selected {len(edge)} edge(s)")
v0 = ring.val().Volume()
v1 = ring.val().chamfer(d1, d2, edge).Volume()
print(f"unchamfered={v0:.9f} chamfered={v1:.9f} removed={v0 - v1:.9f}")
# 理论：三角形 ½·d1·d2，质心半径 R − d1/3，整圆 2π
print(f"theory removed={0.5 * d1 * d2 * 2 * math.pi * (R - d1 / 3):.9f}")
