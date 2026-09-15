"""kernel-bearing-probe — verify W6 tapered bearing section corner math.

Extracts the 4 trapezoid corners of the cup (outer) and cone (inner) race
sections AFTER the full upstream transform chain:
    Sketch.trapezoid(w,h,a1,a2,angle) -> face(angle-rotated about Z)
    .push((cx,cy)) -> translate
    .faces()[0].rotate(Y, -90) -> (radius=|Y|, height=Z)

and compares them against the hand-derived closed-form used by src/bearing.ts.

Run with the cadquery env python:
    C:/Users/ylt/cadquery-env/Scripts/python.exe scripts/kernel-bearing-probe.py
"""
import math
from cadquery import Sketch, Vector, Workplane


def corners_after_transform(w, h, a1, a2, angle, cx, cy):
    """Replicate upstream trapezoid -> push -> rotate(Y,-90), return 4 corners
    as (radius=|Y|, height=Z) in the final frame (before fillet)."""
    sk = Sketch().push([(cx, cy)]).trapezoid(w, h, a1, a2, angle)
    face = sk._faces.Faces()[0]
    rot = face.rotate(Vector(), Vector(0, 1, 0), -90)
    out = []
    for v in rot.Vertices():
        # revolve about Z: radial distance = hypot(X, Y); X is ~0 here
        radius = math.hypot(v.X, v.Y)
        out.append((round(radius, 6), round(v.Z, 6)))
    # sort by height then radius for stable compare
    return sorted(out)


def formula_cup(D, Db, C, a):
    w = (D - Db) / 2
    h = C
    cx = C / 2
    cy = D / 2 - (D - Db) / 4
    # derived: after R_z(90) + translate + rotate(Y,-90)
    # corners (radius, height):
    r1 = abs(cy - w / 2)          # = D/2 - w
    r2 = abs(cy + w / 2)          # = D/2
    # V3 radius = |cy - w/2 + h/tan(a1)|, a1 = a+90 -> 1/tan(a1) = -tan(a)
    r3 = abs(cy - w / 2 - h * math.tan(math.radians(a)))
    return sorted([
        (round(r1, 6), round(cx + h / 2, 6)),
        (round(r2, 6), round(cx + h / 2, 6)),
        (round(r2, 6), round(cx - h / 2, 6)),
        (round(r3, 6), round(cx - h / 2, 6)),
    ])


def formula_cone(d, da, B, cone_angle, T):
    w = (da - d) / 2
    h = B
    cx = T - B / 2
    cy = d / 2 + (da - d) / 2
    a1 = 90 + cone_angle
    # after R_z(-90) + translate + rotate(Y,-90)
    r1 = abs(cy + w / 2)          # = d/2 + w
    r2 = abs(cy - w / 2)          # = d/2
    r3 = abs(cy + w / 2 - h / math.tan(math.radians(a1)))
    return sorted([
        (round(r1, 6), round(cx - h / 2, 6)),
        (round(r2, 6), round(cx - h / 2, 6)),
        (round(r2, 6), round(cx + h / 2, 6)),
        (round(r3, 6), round(cx + h / 2, 6)),
    ])


def main():
    import json as _json
    import cq_warehouse.bearing as b

    # --- 1) tapered M15-42-14.25: verify corner math + cone_length quirk ---
    size = "M15-42-14.25"
    bt = b.SingleRowTaperedRollerBearing(size, "SKT")
    dd = bt.bearing_dict
    D, Db, C, a, B, d, da, T = dd["D"], dd["Dbmin"], dd["C"], dd["a"], dd["B"], dd["d"], dd["da"], dd["T"]
    cone_angle = bt.cone_angle
    print("tapered params: D=%.4f Db=%.4f C=%.4f a=%.4f B=%.4f d=%.4f da=%.4f T=%.4f cone_angle=%.4f"
          % (D, Db, C, a, B, d, da, T, cone_angle))
    print("roller_diameter(upstream)=%.6f" % bt.roller_diameter)
    print("race_center_radius(upstream)=%.6f" % bt.race_center_radius)
    print("roller_count(upstream)=%d" % bt.roller_count)

    cup_measured = corners_after_transform(
        (D - Db) / 2, C, a + 90, 90, 90, C / 2, D / 2 - (D - Db) / 4)
    cup_formula = formula_cup(D, Db, C, a)
    print("\nCUP measured:", cup_measured)
    print("CUP formula :", cup_formula)
    print("CUP match   :", cup_measured == cup_formula)

    cone_measured = corners_after_transform(
        (da - d) / 2, B, 90 + cone_angle, 90, -90, T - B / 2, d / 2 + (da - d) / 2)
    cone_formula = formula_cone(d, da, B, cone_angle, T)
    print("\nCONE measured:", cone_measured)
    print("CONE formula :", cone_formula)
    print("CONE match   :", cone_measured == cone_formula)

    cone_length = (Db / 2) / math.asin(math.radians(a))
    ca2 = math.degrees(math.asin((d / 2) / cone_length))
    print("\ncone_angle via upstream formula=%.6f (matches prop? %s)"
          % (ca2, abs(ca2 - cone_angle) < 1e-9))

    # --- 2) dump derived quantities for the 10 manifest bearing cases (A-side truth) ---
    targets = [
        ("SingleRowAngularContactBallBearing", "M10-30-9"),
        ("SingleRowAngularContactBallBearing", "M15-35-11"),
        ("SingleRowCappedDeepGrooveBallBearing", "M6-19-6"),
        ("SingleRowCappedDeepGrooveBallBearing", "M8-22-7"),
        ("SingleRowCylindricalRollerBearing", "M15-35-11"),
        ("SingleRowCylindricalRollerBearing", "M17-40-12"),
        ("SingleRowDeepGrooveBallBearing", "M6-19-6"),
        ("SingleRowDeepGrooveBallBearing", "M8-22-7"),
        ("SingleRowTaperedRollerBearing", "M15-42-14.25"),
        ("SingleRowTaperedRollerBearing", "M17-40-13.25"),
    ]
    print("\n=== DERIVED QUANTITIES (upstream, 10 manifest cases) ===")
    for cls, sz in targets:
        K = getattr(b, cls)
        brg = K(sz, "SKT")
        print(_json.dumps({
            "class": cls,
            "size": sz,
            "roller_diameter": round(brg.roller_diameter, 6),
            "race_center_radius": round(brg.race_center_radius, 6),
            "roller_count": brg.roller_count,
            "thickness": round(brg.thickness, 6),
        }))


    # --- 3) dump per-size cup-fillet-drop flag (cq behaviour table, W6) ---
    # Upstream `Sketch.vertices().fillet(r34)` on the tapered cup trapezoid SILENTLY
    # DROPS the (r=D/2, h=C) corner fillet for some sizes (OCC MakeFillet2d quirk).
    # Empirically verified: the dropped corner is ALWAYS the top-outer one, and the
    # dropped/kept boundary has no closed form (see W6 analysis doc). The flag below
    # is measured A-side truth consumed by gen-data.ts -> tapered-fillet-drop.json;
    # src/bearing.ts reads it — no heuristics on the TS side.
    print("\n=== TAPERED CUP FILLET DROP TABLE (upstream cq behaviour, all sizes) ===")
    from cadquery import Sketch  # noqa: PLC0415 — probe-local
    import collections as _collections  # noqa: PLC0415

    for sz in b.SingleRowTaperedRollerBearing.sizes("SKT"):
        brg = b.SingleRowTaperedRollerBearing(sz, "SKT")
        dd = brg.bearing_dict
        sk = (
            Sketch()
            .push([(dd["C"] / 2, dd["D"] / 2 - (dd["D"] - dd["Dbmin"]) / 4)])
            .trapezoid((dd["D"] - dd["Dbmin"]) / 2, dd["C"], dd["a"] + 90, 90, 90)
            .reset()
            .vertices()
            .fillet(dd["r34"])
        )
        f = sk._faces.Faces()[0]
        n_circles = sum(1 for e in f.Edges() if e.geomType() == "CIRCLE")
        dropped_local = None
        endpoints = {}
        for e in f.Edges():
            for v in e.Vertices():
                p = (round(v.X, 6), round(v.Y, 6))
                endpoints.setdefault(p, []).append(e.geomType())
        for p, kinds in endpoints.items():
            if kinds.count("LINE") >= 2:
                dropped_local = p  # LINE-LINE joint = corner without fillet
        # local frame: x=height, y=radius → (r, h)
        dropped_rh = (dropped_local[1], dropped_local[0]) if dropped_local else None
        is_top_outer = (
            dropped_rh is not None
            and abs(dropped_rh[0] - dd["D"] / 2) < 1e-6
            and abs(dropped_rh[1] - dd["C"]) < 1e-6
        )
        print(_json.dumps({
            "size": sz,
            "fillet_count": n_circles,
            "drop_top_outer": n_circles == 3 and is_top_outer,
            "dropped_corner_rh": dropped_rh,
        }))


if __name__ == "__main__":
    main()
