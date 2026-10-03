"""P3-3 one-shot truth capture: CadQuery 2.8.0 `faces/edges/vertices` stack push.

Run with C:\\Users\\ylt\\cadquery-env\\Scripts\\python.exe (has OCP + cadquery 2.8.0).
One-shot, NOT part of CI. Captures exact `.size()` / `.vals()` counts for the
progressively-narrowing stack semantics that P3-3 must reproduce in faijs.

Key facts to freeze (mirror `cq.py` _selectObjects: it pushes the selected
sub-shapes of EVERY stack object onto a NEW stack):
  - `faces()/edges()/vertices()` are EAGER: they resolve + push immediately.
  - progressive narrowing operates on the CURRENT (already narrowed) stack.
  - multi-object stacks: each object contributes its selected sub-shapes.
"""
import cadquery as cq
import json

def cube():
    return cq.Workplane('XY').box(1, 1, 1)

def two_solids():
    # two separate solids on the stack (immutable .add appends)
    return cq.Workplane('XY').box(1, 1, 1).box(2, 2, 1)

out = {}

# --- single cube ---
c = cube()
out['cube_faces_ALL'] = c.faces().size()            # all faces -> 6
out['cube_faces_GTZ'] = c.faces('>Z').size()        # top face -> 1
out['cube_faces_PLUSZ'] = c.faces('+Z').size()      # +Z face -> 1
out['cube_faces_GTZ_verts_LTXY'] = c.faces('>Z').vertices('<XY').size()   # 4
out['cube_faces_PLUSZ_verts'] = c.faces('+Z').vertices().size()           # 4 (all of face)
out['cube_faces_GTZ_edges'] = c.faces('>Z').edges().size()                # 4 (face outline)
out['cube_edges_PIPEZ'] = c.edges('|Z').size()      # vertical edges -> 4
out['cube_edges_PIPEZ_verts'] = c.edges('|Z').vertices().size()           # 8 (2 ends each)
out['cube_verts_ALL'] = c.vertices().size()         # 8

# --- two solids on the stack ---
t = two_solids()
out['two_faces_GTZ'] = t.faces('>Z').size()         # 2 (one per solid)
out['two_faces_ALL'] = t.faces().size()             # 12
out['two_faces_GTZ_verts_LTXY'] = t.faces('>Z').vertices('<XY').size()    # 8 (4 per solid)
out['two_edges_PIPEZ'] = t.edges('|Z').size()       # 8
out['two_verts_ALL'] = t.vertices().size()          # 16

# --- progressive narrowing on two solids: faces('>Z').edges() ---
out['two_faces_GTZ_edges'] = t.faces('>Z').edges().size()                 # 8 (4 per top face)
# edges of a single top face after faces('>Z'):
out['cube_faces_GTZ_edges_PLUSX'] = c.faces('>Z').edges('|X').size()      # edges with X-axis dir on top face

# --- empty / no-match behaviours ---
try:
    out['empty_vertices'] = cq.Workplane('XY').vertices().size()
except Exception as e:
    out['empty_vertices'] = 'ERR:' + str(e)

print(json.dumps(out, indent=2))
