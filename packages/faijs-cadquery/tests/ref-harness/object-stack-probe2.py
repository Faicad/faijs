"""Second-pass capture: pin down the three semantics the first probe left open.

Run after object-stack-probe.py; the gaps it closes:
  1. `add(Workplane)` — the first probe's numbers are not consistent with a
     plain "extend that workplane's stack". What actually gets extended?
  2. `findSolid()` returns a Compound even for a single solid — is that
     unconditional, and how does it differ from `solids()`?
  3. `pushPoints` pushes Vector LOCATIONS, not Shapes. So what does `size()`
     mean, and what does `all()` return, on a pushed-points workplane?

Output feeds the same frozen-assertion file; not wired into CI.
"""
import cadquery as cq

out = []


def cap(name, fn):
    try:
        v = fn()
    except Exception as e:  # noqa: BLE001
        v = "RAISES %s: %s" % (type(e).__name__, e)
    out.append((name, v))


def kind(o):
    """`ShapeType` for shapes, plain typename for everything else (Vector/Location)."""
    return getattr(o, "ShapeType", lambda: type(o).__name__)()


def kinds(objs):
    return "%d: %s" % (len(objs), " | ".join(kind(o) for o in objs))


# ==========================================================================
# 1. add(): WHAT gets extended, and does it mutate the receiver?
# ==========================================================================
a2 = cq.Workplane("YZ").box(10, 20, 30)
cap("base: a2.vals()", lambda: kinds(a2.vals()))
cap("add(Workplane) -> kinds", lambda: kinds(cq.Workplane("XY").add(a2).objects))
cap("add(Workplane) -> size", lambda: cq.Workplane("XY").add(a2).size())
# Is it extend-of-vals, or extend-of-solids()?  a2 is one solid either way, so
# build a case with MORE THAN ONE object on the source stack.
multi = cq.Workplane("XY").pushPoints([(0, 0), (10, 0), (20, 0)]).circle(1).extrude(1)
cap("multi.size()", lambda: multi.size())
cap("multi.vals() kinds", lambda: kinds(multi.vals()))
cap("multi.solids().size()", lambda: multi.solids().size())
cap("add(multi Workplane) -> size", lambda: cq.Workplane("XY").add(multi).size())
cap("add(multi) -> kinds", lambda: kinds(cq.Workplane("XY").add(multi).objects))
cap("add(multi.vals()) -> size", lambda: cq.Workplane("XY").add(multi.vals()).size())
# add() returns self AND mutates upstream (in-place). Confirm.
rec = cq.Workplane("XY")
cap("add returns same obj", lambda: rec.add(a2) is rec)
cap("receiver mutated in place", lambda: rec.size())

# ==========================================================================
# 2. findSolid() vs solids() — Compound-always vs per-solid
# ==========================================================================
cube = cq.Workplane("XY").box(1, 1, 1)
cap("cube.findSolid() ShapeType", lambda: cube.findSolid().ShapeType())
cap("cube.solids().size()", lambda: cube.solids().size())
cap("cube.solids().val() ShapeType", lambda: cube.solids().val().ShapeType())
cap("findSolid() volume == solid volume",
    lambda: round(cube.findSolid().Volume() - cube.val().Volume(), 9))
# Two solids on the stack: does findSolid gather BOTH into one compound?
two = cube.faces(">Y").workplane(-0.5).split(keepTop=True, keepBottom=True)
cap("two.size()", lambda: two.size())
cap("two.findSolid() ShapeType", lambda: two.findSolid().ShapeType())
cap("two.findSolid() volume == sum", lambda: round(
    two.findSolid().Volume() - (two.item(0).val().Volume() + two.item(1).val().Volume()), 9))
cap("two.solids().size()", lambda: two.solids().size())
cap("two.solids().val() ShapeType", lambda: two.solids().val().ShapeType())
cap("two.solids().val() volume", lambda: round(
    two.solids().val().Volume(), 6))
# The union that findSolid() builds: a face selection is NOT a solid, so
# findSolid must reach through the parent chain.
cap("faces('>Z').findSolid() ShapeType",
    lambda: cube.faces(">Z").findSolid().ShapeType())
cap("faces('>Z').findSolid() volume",
    lambda: round(cube.faces(">Z").findSolid().Volume(), 6))

# ==========================================================================
# 3. pushPoints: Vector locations on the stack. size() / all() / vals() there.
# ==========================================================================
pp = cq.Workplane("XY").pushPoints([(-0.3, 0.3), (0.3, 0.3), (0.0, 0.0)])
cap("pp.size()", lambda: pp.size())
cap("pp.vals() kinds", lambda: kinds(pp.vals()))
cap("pp.all() len", lambda: len(pp.all()))
cap("pp.all()[0].vals() kinds", lambda: kinds(pp.all()[0].vals()))
cap("pp.all()[1].vals() kinds", lambda: kinds(pp.all()[1].vals()))
cap("pp.first().vals() kinds", lambda: kinds(pp.first().vals()))
cap("pp.item(1).val().toTuple", lambda: tuple(
    round(x, 6) for x in pp.item(1).val().toTuple()))
cap("pp.item(-1).val().toTuple", lambda: tuple(
    round(x, 6) for x in pp.item(-1).val().toTuple()))
# A pushed point is CONSUMED by the geometry op: circle/extrude replace the
# stack with the new solid. (Needs a base solid — cutThruAll goes through
# findSolid(), which walks the parent chain.)
body = (cq.Workplane("XY").box(10, 10, 2, combine=False)
        .faces(">Z").workplane().pushPoints([(-3, 3), (3, 3), (0, -3)])
        .circle(0.5).cutThruAll())
cap("base+push cutThruAll size", lambda: body.size())
cap("base+push cutThruAll kinds", lambda: kinds(body.vals()))
# `center()` also pushes a location (cq.py:1544 area) — check it too.
cap("wp.center() size", lambda: cq.Workplane("XY").box(1, 1, 1).faces(">Z")
    .workplane().center(-0.5, -0.5).size())
cap("wp.center() kinds", lambda: kinds(
    cq.Workplane("XY").box(1, 1, 1).faces(">Z").workplane()
    .center(-0.5, -0.5).vals()))
# The testCylinderPlugin shape (test_cadquery.py:167-169): size()==1 while
# solids().size()==3 — i.e. the fuse collapsed three cylinders into one stack
# object that is a Compound.
plug = (cq.Workplane("XY").pushPoints([(-1, 1), (1, 1), (0, -1)])
        .circle(0.5).extrude(1).combine())
cap("plug.size()", lambda: plug.size())
cap("plug.val() ShapeType", lambda: plug.val().ShapeType())
cap("plug.solids().size()", lambda: plug.solids().size())
cap("plug.faces().size()", lambda: plug.faces().size())
# compare(): the non-combine variant pushes a compound as ONE object
nc = cq.Workplane("XY").pushPoints([(0, 0), (10, 0)]).box(1, 1, 1, combine=False)
cap("combine=False size", lambda: nc.size())
cap("combine=False kinds", lambda: kinds(nc.vals()))
cap("combine=False val() ShapeType", lambda: nc.val().ShapeType())
cap("combine=False solids().size()", lambda: nc.solids().size())
# eachpoint(): does IT push multiple objects, or fuse into one?
# rarray(xSpacing, ySpacing, xCount, yCount) — upstream signature, cq.py:1392.
# 2×1 grid = 2 points.
ep = (cq.Workplane("XY").box(10, 10, 2).faces(">Z").workplane()
      .rarray(3, 3, 2, 1).circle(0.2).extrude(1))
cap("rarray extrude size", lambda: ep.size())
cap("rarray extrude kinds", lambda: kinds(ep.vals()))
cap("rarray extrude solids().size()", lambda: ep.solids().size())
# and the no-combine twin
ep2 = cq.Workplane("XY").rarray(3, 3, 2, 1).circle(0.2).extrude(1, combine=False)
cap("rarray combine=False size", lambda: ep2.size())
cap("rarray combine=False kinds", lambda: kinds(ep2.vals()))

for name, value in out:
    print("%-42s = %s" % (name, value))
