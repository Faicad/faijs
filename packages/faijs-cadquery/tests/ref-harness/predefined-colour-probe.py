"""One-shot CadQuery/OCCT capture: the RGB behind STEP's named colours.

CadQuery writes `DRAUGHTING_PRE_DEFINED_COLOUR('red')` (not COLOUR_RGB) whenever
the colour matches an OCCT predefined name — including plain RGB triples such as
(1,0,0). faijs' STEP colour parser only follows COLOUR_RGB, so every such colour
is silently dropped. This probe captures the authoritative name -> RGB mapping
from OCCT itself (the same table STEPCAFControl_Reader resolves against).

Not wired into CI; values are frozen into packages/core step-color-parser tests.
"""

from OCP.Quantity import Quantity_Color, Quantity_NameOfColor

NAMES = [
    "BLACK", "RED", "GREEN", "BLUE", "YELLOW", "MAGENTA", "CYAN", "WHITE",
    "ORANGE", "PINK", "BROWN", "PURPLE", "GOLD", "GREY", "DARKGREY",
]

print("--- Quantity_Color(Quantity_NOC_<NAME>) ---")
for n in NAMES:
    enum = getattr(Quantity_NameOfColor, "Quantity_NOC_" + n, None)
    if enum is None:
        print("%-10s <no enum>" % n)
        continue
    c = Quantity_Color(enum)
    print("%-10s %.9f %.9f %.9f   OCCT-name=%s" % (
        n.lower(), c.Red(), c.Green(), c.Blue(), c.Name()))

print()
print("--- ColorFromName reverse lookup ---")
for n in ["red", "green", "RED", "Green", "banana", "3"]:
    try:
        c = Quantity_Color.ColorFromName_s(n)
    except Exception as e:
        print("%-10s raised %s: %s" % (n, type(e).__name__, e))
        continue
    print("%-10s %.9f %.9f %.9f  ->  %s" % (n, c.Red(), c.Green(), c.Blue(), c.Name()))

print()
print("--- what CadQuery writes into STEP for RGB triples ---")
import os
import tempfile

import cadquery as cq
from cadquery import Assembly, Color

TRIPLES = [
    ("pure_red", (1.0, 0.0, 0.0)),
    ("half", (0.5, 0.5, 0.5)),
    ("lime", (0.0, 1.0, 0.0)),
    ("navy", (0.0, 0.0, 0.5)),
    ("odd", (0.123, 0.456, 0.789)),
]

path = os.path.join(tempfile.gettempdir(), "cq-predefined-colours.step")
assy = Assembly(name="top_level")
for i, (tag, rgb) in enumerate(TRIPLES):
    assy.add(
        cq.Workplane("XY").box(1, 1, 1),
        name=tag,
        color=Color(*rgb),
        loc=cq.Location((i * 10, 0, 0)),
    )
assy.save(path, "STEP")

text = open(path, encoding="utf-8", errors="ignore").read()
for line in text.splitlines():
    s = line.strip()
    if "DRAUGHTING_PRE_DEFINED_COLOUR" in s or s.startswith("#") and "COLOUR_RGB" in s:
        print("   ", s[:130])

print()
print("--- CadQuery read-back ---")
back = Assembly.importStep(path)
for name, ch in back.traverse():
    if ch.obj is not None and ch.color is not None:
        print("    %-8s %s" % (name, tuple(round(v, 9) for v in ch.color.toTuple())))
print("DIR", os.path.dirname(path))
