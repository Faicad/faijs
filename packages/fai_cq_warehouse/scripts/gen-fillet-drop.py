"""gen-fillet-drop — generate src/data/tapered-fillet-drop.json (W6).

Upstream `Sketch.vertices().fillet(r34)` on the tapered cup trapezoid SILENTLY
DROPS the (r=D/2, h=C) corner fillet for some sizes (OCC `BRepFilletAPI_MakeFillet2d`
quirk; cq 2.8.0). Empirical facts (2026-09-14, all 26 SKT sizes probed):

- When dropped, the dropped corner is ALWAYS the top-outer one (r=D/2, h=C);
- the dropped/kept boundary has NO closed form (edge-length and circle-overlap
  rules both fail to separate the 14 dropped from the 12 kept sizes) — see the
  W6 analysis doc for the falsified candidate rules.

Therefore the flag is measured A-side truth (this script) consumed verbatim by
`src/bearing.ts` — no heuristics on the TS side. Re-run whenever the upstream
CSV or cadquery version changes (the manifest hash guard covers the JSON).

Run with the cadquery env python:
    C:/Users/ylt/cadquery-env/Scripts/python.exe scripts/gen-fillet-drop.py
"""
import json
import sys
from pathlib import Path

UPSTREAM = sys.argv[1] if len(sys.argv) > 1 else "C:/git/CADQ/cq_warehouse/src"
sys.path.insert(0, UPSTREAM)

import cq_warehouse  # noqa: F401,E402
import cq_warehouse.extensions  # noqa: F401,E402 — Workplane.clearanceHole side effect
from cq_warehouse.bearing import SingleRowTaperedRollerBearing  # noqa: E402
from cadquery import Sketch  # noqa: E402


def probe_size(sz: str) -> dict:
    brg = SingleRowTaperedRollerBearing(sz, "SKT")
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
    # LINE-LINE joint = corner without fillet
    endpoints: dict[tuple[float, float], list[str]] = {}
    for e in f.Edges():
        for v in e.Vertices():
            p = (round(v.X, 6), round(v.Y, 6))
            endpoints.setdefault(p, []).append(e.geomType())
    dropped = None
    for p, kinds in endpoints.items():
        if kinds.count("LINE") >= 2:
            dropped = p
    # local frame: x=height, y=radius → (r, h)
    dropped_rh = [dropped[1], dropped[0]] if dropped else None
    is_top_outer = (
        dropped_rh is not None
        and abs(dropped_rh[0] - dd["D"] / 2) < 1e-6
        and abs(dropped_rh[1] - dd["C"]) < 1e-6
    )
    if n_circles == 3 and not is_top_outer:
        raise RuntimeError(f"{sz}: dropped corner is not top-outer — rule changed, investigate")
    return {
        "size": sz,
        "drop_top_outer": n_circles == 3,
    }


def main() -> None:
    sizes = SingleRowTaperedRollerBearing.sizes("SKT")
    rows = [probe_size(sz) for sz in sizes]
    n_drop = sum(1 for r in rows if r["drop_top_outer"])
    out = {
        "_comment": (
            "Tapered cup fillet-drop table: upstream cq Sketch.vertices().fillet(r34) "
            "silently drops the (r=D/2, h=C) corner for these sizes (OCC MakeFillet2d "
            "quirk, no closed-form boundary — see W6 analysis doc). Measured A-side "
            "truth; consumed verbatim by src/bearing.ts. Regenerate with "
            "scripts/gen-fillet-drop.py."
        ),
        "sizes": rows,
    }
    dst = Path(__file__).resolve().parent.parent / "src" / "data" / "tapered-fillet-drop.json"
    dst.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    print(f"wrote {dst}: {len(rows)} sizes, {n_drop} dropped")


if __name__ == "__main__":
    main()
