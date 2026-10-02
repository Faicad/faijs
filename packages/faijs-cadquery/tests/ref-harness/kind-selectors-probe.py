"""One-shot CadQuery 2.8.0 reference capture for the E-class KIND selectors
(wires/shells/solids/compounds) — audit §3.5, method §5.1.

NOT wired into CI; run once, freeze the numbers into
packages/faijs-cadquery/src/kind-selectors.test.ts.

 NOTE: run with the cadquery env interpreter:
   pwsh -NoProfile -Command "& 'C:/Users/ylt/cadquery-env/Scripts/python.exe' '<this>'"
The Git-Bash `python` has no OCP.
"""
import cadquery as cq

out = []


def cap(name, fn):
    try:
        v = fn()
    except Exception as e:  # noqa: BLE001
        v = "RAISES %s: %s" % (type(e).__name__, e)
    out.append((name, v))


def kinds(name, shapes):
    """Render a list of Shapes as an order-sensitive 'type@center' fingerprint."""
    rows = []
    for s in shapes:
        try:
            c = s.Center()
            rows.append("%s@(%.6f,%.6f,%.6f)" % (s.ShapeType(), c.x, c.y, c.z))
        except Exception as e:  # noqa: BLE001
            rows.append("%s@<%s>" % (s.ShapeType(), type(e).__name__))
    return ("%s -> %d: %s" % (name, len(shapes), " | ".join(rows))) if rows else "%s -> 0: []" % name


# --- fixture 1: unit cube, upstream default is centred at the origin ---------
cube = cq.Workplane("XY").box(1, 1, 1)
cap("cube.val().ShapeType()", lambda: cube.val().ShapeType())
cap("cube.wires().size()", lambda: cube.wires().size())
cap("cube.shells().size()", lambda: cube.shells().size())
cap("cube.solids().size()", lambda: cube.solids().size())
cap("cube.compounds().size()", lambda: cube.compounds().size())
cap("cube.faces('>Z').wires().size()", lambda: cube.faces(">Z").wires().size())
cap("cube.wires(kinds)", lambda: kinds("cube.wires()", cube.wires().objects))
cap("cube.shells(kinds)", lambda: kinds("cube.shells()", cube.shells().objects))
cap("cube.solids(kinds)", lambda: kinds("cube.solids()", cube.solids().objects))
cap("cube.faces('>Z').wires(kinds)", lambda: kinds("cube.faces('>Z').wires()", cube.faces(">Z").wires().objects))
cap("cube.faces('>Z').shells(kinds)", lambda: kinds("cube.faces('>Z').shells()", cube.faces(">Z").shells().objects))
cap("cube.faces('>Z').solids().size()", lambda: cube.faces(">Z").solids().size())
cap("cube.wires('>Z').size()", lambda: cube.wires(">Z").size())
cap("cube.shells('>Z').size()", lambda: cube.shells(">Z").size())
cap("cube.solids('>Z').size()", lambda: cube.solids(">Z").size())
cap("cube.wires('>Z')(kinds)", lambda: kinds("cube.wires('>Z')", cube.wires(">Z").objects))

# --- fixture 2: plate with a through hole — the face carries TWO wires ------
holed = cq.Workplane("XY").box(20, 10, 2).faces(">Z").workplane().hole(4)
cap("holed.wires().size()", lambda: holed.wires().size())
cap("holed.faces('>Z').wires().size()", lambda: holed.faces(">Z").wires().size())
cap("holed.faces('>Z').wires(kinds)", lambda: kinds("holed.faces('>Z').wires()", holed.faces(">Z").wires().objects))
cap("holed.solids().size()", lambda: holed.solids().size())

# --- fixture 3: two disjoint boxes -> union yields a compound-of-solids -----
# This is upstream's documented "weird use case": a stack object that IS a
# Solid class instance whose ShapeType() is 'Compound'.
b1 = cq.Workplane("XY").box(1, 1, 1)
b2 = cq.Workplane("XY").box(1, 1, 1).translate((5, 0, 0))
two = b1.union(b2)
cap("two.val().ShapeType()", lambda: two.val().ShapeType())
cap("two.val() isinstance Solid", lambda: isinstance(two.val(), cq.Solid))
cap("two.solids().size()", lambda: two.solids().size())
cap("two.solids(kinds)", lambda: kinds("two.solids()", two.solids().objects))
cap("two.compounds().size()", lambda: two.compounds().size())
cap("two.compounds(kinds)", lambda: kinds("two.compounds()", two.compounds().objects))
cap("two.wires().size()", lambda: two.wires().size())
cap("two.shells().size()", lambda: two.shells().size())
cap("two.faces().size()", lambda: two.faces().size())
# .val() bypasses the stack, so normal property access applies
cap("two.val().Solids() len", lambda: len(two.val().Solids()))
cap("two.val().Compounds() len", lambda: len(two.val().Compounds()))
cap("two.val().Wires() len", lambda: len(two.val().Wires()))

# --- fixture 4: three-solids compound via multi-union -----------------------
b3 = cq.Workplane("XY").box(1, 1, 1).translate((0, 5, 0))
three = b1.union(b2).union(b3)
cap("three.solids().size()", lambda: three.solids().size())
cap("three.compounds().size()", lambda: three.compounds().size())
cap("three.compounds(kinds)", lambda: kinds("three.compounds()", three.compounds().objects))

# --- fixture 5: Shape-level access (implies the same collection on a Shape) --
cap("cube.val().Wires() len", lambda: len(cube.val().Wires()))
cap("cube.val().Shells() len", lambda: len(cube.val().Shells()))
cap("cube.val().Solids() len", lambda: len(cube.val().Solids()))
cap("cube.val().Compounds() len", lambda: len(cube.val().Compounds()))

# --- fixture 6: selection over wires needs Center() dispatch ---------------
# A wire's Center() is its LINEAR centre of mass (not the bbox centre); for an
# L-shaped wire the two differ, and directional selection follows Center().
L = (
    cq.Workplane("XY")
    .moveTo(0, 0)
    .lineTo(10, 0)
    .lineTo(10, 2)
    .lineTo(2, 2)
    .lineTo(2, 10)
    .lineTo(0, 10)
    .close()
    .extrude(1)
)
cap("L.val().ShapeType()", lambda: L.val().ShapeType())
cap("L.faces('>Z').wires().size()", lambda: L.faces(">Z").wires().size())
cap("L.faces('>Z').wires(kinds)", lambda: kinds("L.faces('>Z').wires()", L.faces(">Z").wires().objects))
cap(
    "L.faces('>Z').wires()[0].Center() vs bbox centre",
    lambda: "Center=%s bbox=%s"
    % (
        L.faces(">Z").wires().val().Center(),
        tuple(
            (a + b) / 2
            for a, b in (
                (L.faces(">Z").wires().val().BoundingBox().xmin, L.faces(">Z").wires().val().BoundingBox().xmax),
                (L.faces(">Z").wires().val().BoundingBox().ymin, L.faces(">Z").wires().val().BoundingBox().ymax),
                (L.faces(">Z").wires().val().BoundingBox().zmin, L.faces(">Z").wires().val().BoundingBox().zmax),
            )
        ),
    ),
)

for n, v in out:
    print("%-46s %s" % (n, v))

print()
print("--- when does upstream's _collectProperty('Solids') special case fire? ---")
print("    (fires iff a STACK object isinstance(o, Solid) and o.ShapeType() == 'Compound')")


def stack_scan(label, wp):
    cells = []
    for o in wp.objects:
        try:
            cells.append(
                "%s/%s%s"
                % (
                    type(o).__name__,
                    o.ShapeType(),
                    " <== SPECIAL CASE" if isinstance(o, cq.Solid) and o.ShapeType() == "Compound" else "",
                )
            )
        except Exception as e:  # noqa: BLE001
            cells.append("<%s>" % type(e).__name__)
    print("%-34s %s" % (label, ", ".join(cells) if cells else "(empty stack)"))


stack_scan("box", cq.Workplane("XY").box(1, 1, 1))
stack_scan("box.faces('>Z')", cq.Workplane("XY").box(1, 1, 1).faces(">Z"))
stack_scan("box.wires()", cq.Workplane("XY").box(1, 1, 1).wires())
stack_scan("box.solids()", cq.Workplane("XY").box(1, 1, 1).solids())
stack_scan("box.union(other)", two)
stack_scan("box.cut(other)", cq.Workplane("XY").box(1, 1, 1).cut(cq.Workplane("XY").box(0.2, 0.2, 0.2)))
stack_scan(
    "box.union(other).union(third)",
    cq.Workplane("XY").box(1, 1, 1)
    .union(cq.Workplane("XY").box(1, 1, 1).translate((5, 0, 0)))
    .union(cq.Workplane("XY").box(1, 1, 1).translate((0, 5, 0))),
)
stack_scan("newObject([two.val()])", cq.Workplane("XY").newObject([two.val()]))
# findSolid() is the classic "reference to the context solid" that can be a
# Solid instance wrapping a compound — the case the special case defends against
try:
    ctx = two.findSolid()
    print("%-34s %s/%s special=%s" % ("two.findSolid()", type(ctx).__name__, ctx.ShapeType(), isinstance(ctx, cq.Solid) and ctx.ShapeType() == "Compound"))
except Exception as e:  # noqa: BLE001
    print("%-34s RAISES %s: %s" % ("two.findSolid()", type(e).__name__, e))
try:
    forced = cq.Solid(two.val().wrapped)
    print("%-34s %s/%s special=%s" % ("cq.Solid(compound.wrapped)", type(forced).__name__, forced.ShapeType(), isinstance(forced, cq.Solid) and forced.ShapeType() == "Compound"))
    print("%-34s Compounds()=%d" % ("cq.Solid(compound).Compounds()", len(forced.Compounds())))
except Exception as e:  # noqa: BLE001
    print("%-34s RAISES %s: %s" % ("cq.Solid(compound.wrapped)", type(e).__name__, e))

print()
print("--- wire Center() vs bbox centre (proves Center is the type-dispatched COM) ---")
LW = [(0, 0), (10, 0), (10, 2), (2, 2), (2, 10), (0, 10), (0, 0)]
Lwire = cq.Wire.makePolygon([cq.Vector(*p) for p in LW])
RW = [(30, 0), (20, 0), (20, 2), (28, 2), (28, 10), (30, 10), (30, 0)]
Rwire = cq.Wire.makePolygon([cq.Vector(*p) for p in RW])


def wb(w):
    bb = w.BoundingBox()
    return "Center=(%.6f,%.6f,%.6f) bbox=(%.6f,%.6f,%.6f) len=%.6f area=%.6f" % (
        w.Center().x, w.Center().y, w.Center().z,
        (bb.xmin + bb.xmax) / 2, (bb.ymin + bb.ymax) / 2, (bb.zmin + bb.zmax) / 2,
        w.Length(), w.Area(),
    )


print("L wire  %s" % wb(Lwire))
print("R wire  %s" % wb(Rwire))
print("both wires: wires('>X') -> 1 wires('>Y') -> 1 (they differ!)")


def kinds2(name, shapes):
    return kinds(name, shapes)


lw_list = [Lwire, Rwire]
for tok in (">X", "<X", ">Y", "<Y"):
    sel = cq.selectors.StringSyntaxSelector(tok).filter(lw_list)
    print(
        "%-24s %s"
        % ("StringSyntaxSelector('%s')" % tok, ", ".join("Center=(%.4f,%.4f)" % (s.Center().x, s.Center().y) for s in sel)),
    )

# Fixture where Center-ordering DISAGREES with bbox-centre ordering: this is the
# probe that separates a faithful Center() port from a bbox-centre shortcut.
PW = [(10, 0), (0, 0), (0, 2), (8, 2), (8, 10), (10, 10), (10, 0)]
QW = [(0.9, 0), (10.9, 0), (10.9, 2), (2.9, 2), (2.9, 10), (0.9, 10), (0.9, 0)]
Pw = cq.Wire.makePolygon([cq.Vector(*p) for p in PW])
Qw = cq.Wire.makePolygon([cq.Vector(*p) for p in QW])
print()
print("--- Center vs bbox centre disagree (ties-break fixture) ---")
print("P wire  %s" % wb(Pw))
print("Q wire  %s" % wb(Qw))
for tok in (">X", "<X"):
    sel = cq.selectors.StringSyntaxSelector(tok).filter([Pw, Qw])
    print(
        "%-24s %s"
        % ("StringSyntaxSelector('%s')" % tok, ", ".join("Center=(%.4f,%.4f)" % (s.Center().x, s.Center().y) for s in sel)),
    )
print("len P=%.6f Q=%.6f" % (Pw.Length(), Qw.Length()))

# ---------------------------------------------------------------------------
# Fixtures that mirror the TS test constructions exactly (corner-anchored), so
# the frozen numbers can be asserted against a faijs-rebuilt shape.
# ---------------------------------------------------------------------------
print()
print("--- corner-anchored fixtures (mirror src/kind-selectors.test.ts) ---")
_corner_start = len(out)

TPLATE = cq.Solid.makeBox(20, 10, 2)
T_HOLED = TPLATE.cut(cq.Solid.makeCylinder(0.5, 4, pnt=cq.Vector(5, 5, -1))).cut(
    cq.Solid.makeCylinder(1.5, 4, pnt=cq.Vector(14, 5, -1))
)
cap("plate.wires() len", lambda: len(TPLATE.Wires()))
cap("plate.Shells() len", lambda: len(TPLATE.Shells()))
cap("plate.Solids() len", lambda: len(TPLATE.Solids()))
cap("plate.Compounds() len", lambda: len(TPLATE.Compounds()))
cap("plate.Faces() len", lambda: len(TPLATE.Faces()))
cap("plate.wires(kinds)", lambda: kinds("plate.Wires()", TPLATE.Wires()))
top = [f for f in TPLATE.Faces() if abs(f.Center().z - 2) < 1e-9]
cap("plate top face count", lambda: len(top))
cap("plate top face .Wires() len", lambda: len(top[0].Wires()))
cap("plate top face .Shells() len", lambda: len(top[0].Shells()))
cap("plate top face .Solids() len", lambda: len(top[0].Solids()))
cap("plate top face .Compounds() len", lambda: len(top[0].Compounds()))
cap("holed.Wires() len", lambda: len(T_HOLED.Wires()))
cap("holed top face .Wires() len", lambda: len([f for f in T_HOLED.Faces() if abs(f.Center().z - 2) < 1e-9][0].Wires()))
cap(
    "holed top face wires(kinds)",
    lambda: kinds("holed top wires", [f for f in T_HOLED.Faces() if abs(f.Center().z - 2) < 1e-9][0].Wires()),
)
hwires = [f for f in T_HOLED.Faces() if abs(f.Center().z - 2) < 1e-9][0].Wires()
cap("holed top wires lengths", lambda: [round(w.Length(), 6) for w in hwires])

# two disjoint boxes at x=0..1 and x=5..6, joined into one compound
TWO_SOLIDS = cq.Compound.makeCompound(
    [cq.Solid.makeBox(1, 1, 1), cq.Solid.makeBox(1, 1, 1, pnt=cq.Vector(5, 0, 0))]
)
cap("2box.Solids() len", lambda: len(TWO_SOLIDS.Solids()))
cap("2box.Shells() len", lambda: len(TWO_SOLIDS.Shells()))
cap("2box.Wires() len", lambda: len(TWO_SOLIDS.Wires()))
cap("2box.Faces() len", lambda: len(TWO_SOLIDS.Faces()))
cap("2box.Compounds() len", lambda: len(TWO_SOLIDS.Compounds()))
cap("2box.Solids(kinds)", lambda: kinds("2box.Solids()", TWO_SOLIDS.Solids()))
cap("2box.Compounds(kinds)", lambda: kinds("2box.Compounds()", TWO_SOLIDS.Compounds()))
cap(
    "StringSyntaxSelector('>X') over 2box wires",
    lambda: kinds(">X(2box.Wires())", cq.selectors.StringSyntaxSelector(">X").filter(TWO_SOLIDS.Wires())),
)
cap(
    "StringSyntaxSelector('>X') over 2box solids",
    lambda: kinds(">X(2box.Solids())", cq.selectors.StringSyntaxSelector(">X").filter(TWO_SOLIDS.Solids())),
)
cap(
    "StringSyntaxSelector('<X') over 2box solids",
    lambda: kinds("<X(2box.Solids())", cq.selectors.StringSyntaxSelector("<X").filter(TWO_SOLIDS.Solids())),
)
cap(
    "StringSyntaxSelector('>X') over plate top wires",
    lambda: kinds(">X(plate top wires)", cq.selectors.StringSyntaxSelector(">X").filter(top[0].Wires())),
)
cap(
    "StringSyntaxSelector('>X') over holed top wires",
    lambda: kinds(">X(holed top wires)", cq.selectors.StringSyntaxSelector(">X").filter(hwires)),
)

print()
for n, v in out[_corner_start:]:
    print("%-46s %s" % (n, v))
