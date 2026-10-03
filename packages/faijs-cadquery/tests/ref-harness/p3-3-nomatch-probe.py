"""P3-3 truth: what does `faces(<sel>)` return on a NARROWED (single-face) stack?

Owns the "no match -> empty stack" freeze in faces-edges-vertices-stack.test.ts.
The top face has normal +Z, so:
  - `faces('|Z')` on a face whose normal IS +Z -> the face itself (parallel)  -> 1
  - `faces('|X')` on the same face (normal not parallel to X)                 -> 0 (empty)
"""
import cadquery as cq

out = {}
c = cq.Workplane("XY").box(1, 1, 1)

out["top_size"] = c.faces(">Z").size()               # 1
out["top_then_parZ"] = c.faces(">Z").faces("|Z").size()   # face normal +Z is parallel to Z
out["top_then_parX"] = c.faces(">Z").faces("|X").size()   # normal +Z not parallel to X
out["cube_parX"] = c.faces("|X").size()              # 2 side faces (normals ±X)

for k, v in out.items():
    print(f"{k} = {v}")
