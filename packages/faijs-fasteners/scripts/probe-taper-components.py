# Temporary diagnostic: dump A-side (upstream CadQuery) component volumes for
# tapered bearings m15 / m17 to localize the 1.37% residual observed in B-side.
import sys, os
sys.path.insert(0, r"C:\git\CADQ\cq_warehouse\src")
import cadquery as cq  # noqa: F401
import cq_warehouse  # noqa: F401
import cq_warehouse.extensions  # noqa: F401
from cq_warehouse.bearing import SingleRowTaperedRollerBearing


def comps(size):
    b = SingleRowTaperedRollerBearing(size=size, bearing_type="SKT")
    cup = cq.Workplane("XZ").add(b.outer_race_section().val()).toPending().revolve().val()
    cone = cq.Workplane("XZ").add(b.inner_race_section().val()).toPending().revolve().val()
    roller = b.roller()
    cage = b.cage()
    fused = b  # already a fused solid
    cup_cone = cup.fuse(cone)
    return {
        "cup": cup.Volume(),
        "cone": cone.Volume(),
        "roller": roller.Volume(),
        "cage": cage.Volume(),
        "cup+cone": cup_cone.Volume(),
        "total": fused.Volume(),
        "n_rollers": b.roller_count,
        "rcr": b.race_center_radius,
        "rdiam": b.roller_diameter,
    }


for size in ["M15-42-14.25", "M17-40-13.25"]:
    c = comps(size)
    print(f"=== A-side {size} ===")
    for k, v in c.items():
        print(f"  {k:12s} {v}")
