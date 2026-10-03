"""P3-3 one-shot truth capture (2): a GENUINE multi-solid stack.

`.box().box()` fuses (combine=True) -> NOT a 2-object stack. To get a real
multi-object stack, add a separately-translated solid. Freezes what `faces/
edges/vertices` must push when the Workplane stack carries >1 solid.
"""
import cadquery as cq
import json

# two solids on the stack: box at origin + box translated away
w = (cq.Workplane('XY').box(1, 1, 1)
     .add(cq.Workplane('XY').box(1, 1, 1).translate((5, 0, 0))))
out = {}
out['stack_len'] = w.size()                       # 2
out['faces_ALL'] = w.faces().size()               # 12
out['faces_GTZ'] = w.faces('>Z').size()           # 2 (one top face per solid)
out['faces_GTZ_verts_LTXY'] = w.faces('>Z').vertices('<XY').size()  # 1 (GLOBAL min x+y over the pooled 8 verts)
out['faces_GTZ_verts_EMPTY'] = w.faces('>Z').vertices().size()     # 8 (4 per solid)
out['edges_PIPEZ'] = w.edges('|Z').size()         # 8
out['verts_ALL'] = w.vertices().size()            # 16
out['faces_GTZ_edges'] = w.faces('>Z').edges().size()                  # 8
out['faces_GTZ_edges_PIPEX'] = w.faces('>Z').edges('|X').size()       # 4
print(json.dumps(out, indent=2))
