"""Generate BARE herringbone reference STEPs (no chamfer/bore/hub/spokes).

Used to validate fai_cq_gears herringbone solid build against a clean cq_gears
baseline. Run with cadquery-env; cq_gears resolved from FAI_CQ_GEARS_SRC.
"""
import json
import os
import sys

SRC = os.environ.get("FAI_CQ_GEARS_SRC") or r"C:\git\CADQ\cq_gears"
if (os.path.join(SRC, "cq_gears", "__init__.py")):
    sys.path.insert(0, SRC)

import cadquery as cq
import cq_gears

OUT = r"D:\Faicad\faijs\packages\fai_cq_gears\fixtures\reference"

CASES = [
    {"id": "hb-basic", "class": "HerringboneGear",
     "args": {"module": 2.0, "teeth_number": 20, "width": 16.0, "helix_angle": 30.0}},
    {"id": "hbring-basic", "class": "HerringboneRingGear",
     "args": {"module": 2.0, "teeth_number": 40, "width": 16.0, "helix_angle": 28.0, "rim_width": 12.0}},
]

result = []
for e in CASES:
    cls = getattr(cq_gears, e["class"])
    gear = cls(**e["args"])
    body = gear.build()
    bb = body.BoundingBox()
    vol = float(body.Volume())
    cq.exporters.export(body, os.path.join(OUT, e["id"] + ".step"))
    item = {"id": e["id"], "class": e["class"], "args": e["args"],
            "volume": vol,
            "bbox": [float(bb.xlen), float(bb.ylen), float(bb.zlen)]}
    result.append(item)
    print(f"{e['id']}: vol={vol} bbox={item['bbox']}")

with open(os.path.join(OUT, "herringbone-bare-manifest.json"), "w", encoding="utf-8") as f:
    json.dump({"cases": result}, f, indent=2)
print("done")
