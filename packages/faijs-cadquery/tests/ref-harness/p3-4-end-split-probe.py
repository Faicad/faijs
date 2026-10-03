"""P3-4 truth capture (one-shot, not wired into CI).

Freezes the CadQuery 2.8.0 semantics for:
  - `.end(n)` parent-chain walking (cq.py:669)
  - `.split(keepTop, keepBottom)` multi-object push (cq.py:258)
  - `.all()` / `.size()` on the split stack (cq.py:346/358)

Run: C:/Users/ylt/cadquery-env/Scripts/python.exe p3-4-end-split-probe.py
"""
import json
import cadquery as cq

out = {}

# ── end() parent chain ─────────────────────────────────────────────────────
# test_cadquery.py:5005-5006
out['box_end_objs'] = len(cq.Workplane().box(1, 1, 1).end().objects)          # 0
out['box_box_end2_objs'] = len(cq.Workplane().box(1, 1, 1).box(2, 2, 1).end(2).objects)  # 0
# faces() then end() → the pre-selection workplane (still holds the box)
out['box_faces_end_objs'] = len(cq.Workplane().box(1, 1, 1).faces('>Z').end().objects)   # 1
out['box_faces_end_valtype'] = cq.Workplane().box(1, 1, 1).faces('>Z').end().val().ShapeType()  # Solid
# end(n) default is 1
out['end_default_1'] = len(cq.Workplane().box(1, 1, 1).faces('>Z').workplane().end().objects)
# over-walking raises
try:
    cq.Workplane().box(1, 1, 1).end(5)
    out['end_overwalk'] = 'no-raise'
except ValueError:
    out['end_overwalk'] = 'ValueError'

# ── split() multi-object push ──────────────────────────────────────────────
c = cq.Workplane().box(3, 3, 3).faces('>Z').workplane().circle(1).cutThruAll()
box = cq.Workplane().box(4, 4, 4)
sp = box.split(keepTop=True, keepBottom=True)
out['split_size'] = sp.size()                                    # 2
out['split_solids_size'] = sp.solids().size()                    # 2
out['split_item0_faces'] = sp.item(0).faces().size()             # 6 (a half cube has 6 faces)
out['split_item1_faces'] = sp.item(1).faces().size()             # 6
out['split_val_type'] = sp.val().ShapeType()                     # Solid
out['split_val_vol'] = round(sp.val().Volume(), 6)              # 32 (half of 64)
# all() → one Workplane per stack object
out['split_all_len'] = len(sp.all())                            # 2
out['split_all_types'] = [w.val().ShapeType() for w in sp.all()]  # ['Solid','Solid']
# keepTop only → single object
kp = box.split(keepTop=True, keepBottom=False)
out['split_keeptop_size'] = kp.size()                           # 1

# ── add() appends ─────────────────────────────────────────────────────────
a = cq.Workplane().box(1, 1, 1)
b2 = cq.Workplane().box(1, 1, 1).translate((5, 0, 0))
out['add_size'] = a.add(b2).size()                              # 2 (b2's single representative)

print(json.dumps(out, indent=2))
