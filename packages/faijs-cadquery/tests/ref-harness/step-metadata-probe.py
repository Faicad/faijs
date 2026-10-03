"""One-shot CadQuery 2.8.0 capture *and* fixture generator: STEP metadata.

Not wired into CI — per docs/plans/2026-10-02-cadquery-port-gap-audit.md §5.1 the
values printed here are frozen into
packages/faijs-cadquery/src/assembly-import-step.test.ts as assertions.

Question the probe answers: when CadQuery writes an Assembly to STEP and reads it
back, what survives? Names, colors, layers, sub-shape metadata, and the assembly
tree shape (which decides how a reader must walk the XCAF document).

It also REGENERATES the committed fixtures under
packages/fixtures/data/step-metadata/ (they are one-shot artifacts: re-run this
script rather than hand-editing a STEP file):

  cq-assembly-two-parts.step  — upstream's `subshape_assy` structure, the import
                                target of Assembly.importStep()
  cq-plain-shape.step         — a bare shape export (no assembly) — must raise
  cq-predefined-colours.step  — named vs RGB colours, for the colour parser

Usage (pwsh, OCP python):
  & pwsh -NoProfile -Command "& '<env>/Scripts/python.exe' '<this file>' 2>&1 |
      Out-File -Encoding utf8 <out>"
"""

import os
import shutil
import tempfile

import cadquery as cq
from cadquery import Assembly, Color, Location, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.normpath(os.path.join(HERE, "..", "..", "..", "fixtures", "data", "step-metadata"))
SCRATCH = os.path.join(tempfile.gettempdir(), "cq-step-metadata-probe")
os.makedirs(FIXTURES, exist_ok=True)
os.makedirs(SCRATCH, exist_ok=True)


def p(label, value):
    print("%-44s %s" % (label, value))


def dump_tree(assy, tag):
    print("--- %s ---" % tag)
    p("root name", repr(assy.name))
    for name, ch in assy.traverse():
        col = tuple(round(v, 4) for v in ch.color.toTuple()) if ch.color else None
        loc = ch.loc.toTuple() if hasattr(ch.loc, "toTuple") else ch.loc
        p("node %r" % name, "obj=%s color=%s loc=%s" % (type(ch.obj).__name__, col, loc))


def emit(assy, fixture_name):
    """Write the fixture into the repo, and return the scratch copy CQ reads back."""
    scratch = os.path.join(SCRATCH, fixture_name)
    assy.save(scratch, "STEP")
    shutil.copyfile(scratch, os.path.join(FIXTURES, fixture_name))
    return scratch


# ------------------------------------------------- A. assembly fixture (the import target)
def subshape_assy():
    """Structurally upstream's `subshape_assy` fixture: two named, coloured parts,
    the second one located. No sub-shape metadata (the kernel cannot express it —
    see section B, which documents the gap rather than pretending otherwise)."""
    a = Assembly(name="top_level")
    a.add(cq.Workplane().box(10.0, 10.0, 10.0), name="cube_1", color=Color("green"))
    a.add(
        cq.Workplane().cylinder(10.0, 2.5),
        name="cyl_1",
        color=Color("blue"),
        loc=Location((0.0, 0.0, -10.0)),
    )
    return a


STEP_A = emit(subshape_assy(), "cq-assembly-two-parts.step")
a = Assembly.importStep(STEP_A)
dump_tree(a, "A: cq-assembly-two-parts.step -> Assembly.importStep")
for name, ch in a.traverse():
    if ch.obj is not None:
        bb = ch.obj.BoundingBox()
        p(
            "  %r" % name,
            "color=%s vol=%.7f bbox=(%.3f,%.3f,%.3f)-(%.3f,%.3f,%.3f)"
            % (
                tuple(round(v, 4) for v in ch.color.toTuple()) if ch.color else None,
                ch.obj.Volume(),
                bb.xmin, bb.ymin, bb.zmin, bb.xmax, bb.ymax, bb.zmax,
            ),
        )

# ---------------------------------------------------------- B. sub-shape metadata (NOT portable)
b = Assembly(name="top_level")
wp = cq.Workplane().box(10.0, 10.0, 10.0)
solid = wp.val()
b.add(solid, name="cube_1", color=Color("green"))
face = wp.faces(">Z").val()
b.addSubshape(face, name="cube_1_top_face", color=Color("red"), layer="cube_1_top_face_layer")
STEP_B = os.path.join(SCRATCH, "b-subshapes.step")
b.save(STEP_B, "STEP")
rb = Assembly.importStep(STEP_B)
print("--- B: sub-shape name/color/layer round trip (CadQuery only) ---")
for name, ch in rb.traverse():
    sn = getattr(ch, "_subshape_names", {})
    sl = getattr(ch, "_subshape_layers", {})
    if sn or sl:
        p("  %r subshape names" % name, [v for v in sn.values()])
        p("  %r subshape layers" % name, [v for v in sl.values()])
text_b = open(STEP_B, encoding="utf-8", errors="ignore").read()
p("  ADVANCED_FACE count in file", text_b.count("ADVANCED_FACE"))
p("  PRESENTATION_LAYER_ASSIGNMENT", text_b.count("PRESENTATION_LAYER_ASSIGNMENT"))

# --------------------------------------------------------- C. bare shape export (must be rejected)
plain = cq.Workplane().box(10, 10, 10)
STEP_C = os.path.join(SCRATCH, "cq-plain-shape.step")
plain.val().exportStep(STEP_C)
shutil.copyfile(STEP_C, os.path.join(FIXTURES, "cq-plain-shape.step"))
print("--- C: bare shape export ---")
try:
    Assembly.importStep(STEP_C)
    p("  Assembly.importStep", "OK (unexpected)")
except Exception as e:
    p("  Assembly.importStep", "%s: %s" % (type(e).__name__, e))

# ------------------------------------------------------------- D. named colours (parser fixture)
TRIPLES = [
    ("pure_red", (1.0, 0.0, 0.0)),
    ("half", (0.5, 0.5, 0.5)),
    ("lime", (0.0, 1.0, 0.0)),
    ("navy", (0.0, 0.0, 0.5)),
    ("odd", (0.123, 0.456, 0.789)),
]
c = Assembly(name="top_level")
for i, (tag, rgb) in enumerate(TRIPLES):
    c.add(cq.Workplane().box(1, 1, 1), name=tag, color=Color(*rgb), loc=Location((i * 10, 0, 0)))
STEP_D = emit(c, "cq-predefined-colours.step")
back = Assembly.importStep(STEP_D)
print("--- D: named vs RGB colour round trip ---")
for name, ch in back.traverse():
    if ch.obj is not None and ch.color is not None:
        p("  %r" % name, tuple(round(v, 9) for v in ch.color.toTuple()))

print()
print("FIXTURES", FIXTURES)
