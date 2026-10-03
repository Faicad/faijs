"""P3-3 truth (4b): eachpoint correctly placing the bump at each face centre."""
import cadquery as cq
import json

base = cq.Workplane('XY').box(1, 1, 1)
faceWp = base.faces('|Z')          # two planar faces
out = {}
out['val_after_faces_type'] = faceWp.val().ShapeType()   # Solid or Face?

def place(loc):
    v = loc.toVector()
    return cq.Solid.makeBox(0.1, 0.1, 0.1).translate(v.x, v.y, v.z)

res = faceWp.eachpoint(place).val()
bb = res.BoundingBox()
out['eachpoint_bbox_z'] = round(bb.zmax - bb.zmin, 4)
out['eachpoint_bbox_x'] = round(bb.xmax - bb.xmin, 4)
out['eachpoint_val_type'] = res.ShapeType()
print(json.dumps(out, indent=2))
