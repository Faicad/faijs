"""P3-3 one-shot truth capture (3): progressive narrowing carried on a FACE.

Freezes what `edges()`/`vertices()` must push when the Workplane stack already
holds narrowed faces (the `faces('>Z').edges(...)` case).
"""
import cadquery as cq
import json

c = cq.Workplane('XY').box(1, 1, 1)
out = {}
# after faces('>Z') the stack holds the top face; edges/vertices of THAT face:
out['gtZ_edges_PIPEZ'] = c.faces('>Z').edges('|Z').size()      # 4 (face outline)
out['gtZ_edges_EMPTY'] = c.faces('>Z').edges().size()          # 4
out['gtZ_edges_PIPEX'] = c.faces('>Z').edges('|X').size()      # 2
out['gtZ_verts_EMPTY'] = c.faces('>Z').vertices().size()       # 4
out['gtZ_verts_LTZ'] = c.faces('>Z').vertices('<Z').size()     # 1 (min z over face's 4 verts -> 1)
out['gtZ_edges_GTZ'] = c.faces('>Z').edges('>Z').size()        # 0 (no edge parallel Z)
# recompute the two deferred-marker assertions that P3-3 flips:
out['gtZ_size'] = c.faces('>Z').size()                         # 1
out['gtZ_edge_PIPEZ_size'] = c.faces('>Z').edges('|Z').size() # 4
print(json.dumps(out, indent=2))
