# probe-case26.py — cq 侧 case26 顶盖面边集实证（一次性诊断，精确复刻源码序列）
import numpy as np
import cadquery as cq
import sys
sys.path.insert(0, r"C:\git\CADQ\cq_gears")
from cq_gears.rack_gear import RackGear

g = RackGear(module=4, length=300, width=20, height=18, helix_angle=-60)
faces_all = g._build_gear_faces()

# 复刻源码第 226 行上下文：构建 tp 时 wp 里只有 teeth+ls+rs+bk（tp/bt 尚未 append）
working = faces_all[:-2]

wp = cq.Workplane('XY').add(working)
tp_edges = wp.edges('>Z')
print("edge count:", tp_edges.size())
xs = []
for e in tp_edges.vals():
    b = e.BoundingBox()
    xs.append((b.xmin, b.xmax))
xs.sort()
print("xmin overall:", min(x[0] for x in xs))
print("xmax overall:", max(x[1] for x in xs))
print("right-most 5 edges (xmin,xmax):")
for x in xs[-5:]:
    print("  %.4f %.4f" % x)

wires = wp.edges('>Z').toPending().consolidateWires().vals()
print("wire count:", len(wires))
for i, w in enumerate(wires):
    b = w.BoundingBox()
    print("  wire%d: edges=%d x=[%.4f,%.4f] closed=%s" % (i, len(w.Edges()), b.xmin, b.xmax, w.IsClosed()))

# 再看实际 build 出的 solid 顶面完整性：体积 + 面数
body = g.build()
print("build volume:", body.Volume())
print("build faces:", len(body.Faces()))

# rs 端面实证：cq 的 rs_face 边界 z 范围
rs_face = faces_all[-2]  # tp 之前 append 的顺序: teeth..., ls, rs, bk, tp, bt -> 倒数第3
# 重新按源码顺序拿：faces = teeth + [ls, rs, bk, tp, bt]
ls_face, rs_face, bk_face, tp_face, bt_face = faces_all[-5:]
b = rs_face.BoundingBox()
print("rs bbox: x=[%.6f,%.6f] y=[%.4f,%.4f] z=[%.6f,%.6f]" % (b.xmin, b.xmax, b.ymin, b.ymax, b.zmin, b.zmax))
for e in rs_face.Edges():
    eb = e.BoundingBox()
    print("  rs edge: x=[%.4f,%.4f] z=[%.6f,%.6f]" % (eb.xmin, eb.xmax, eb.zmin, eb.zmax))
# 顶点 z 范围
vs = rs_face.Vertices()
print("rs vertex z:", sorted(set(round(v.Z, 6) for v in vs)))
