"""One-shot CadQuery 2.8.0 reference capture for the Workplane OBJECT STACK
(`objects` / `all` / `size` / `first` / `last` / `item` / `end` / `add` /
`findSolid` / `filter` / `map` / `apply` / `sort`) — P3-1 of
docs/plans/2026-10-03-cadquery-object-stack-p3-plan.md.

This family is INVISIBLE to STEP comparison: a stack is a list of in-process
sub-shape references, and the only thing an export can see is `val()` =
`objects[0]` (audit §5.1). So the truth has to be captured once, here, and
frozen into `src/object-stack.test.ts` as assertions.

NOT wired into CI. Run once:
   pwsh -NoProfile -Command "& 'C:/Users/ylt/cadquery-env/Scripts/python.exe' '<this>'"
The Git-Bash `python` has no OCP.

Every GOTCHA row is annotated with its `cq.py` line so a future reader can tell
"upstream semantic we deliberately match" from "upstream quirk we deviate from".
"""
import cadquery as cq

out = []


def cap(name, fn):
    try:
        v = fn()
    except Exception as e:  # noqa: BLE001
        v = "RAISES %s: %s" % (type(e).__name__, e)
    out.append((name, v))


def types(objs):
    """Order-sensitive fingerprint of a stack: ShapeType per element."""
    return "%d: %s" % (len(objs), " | ".join(o.ShapeType() for o in objs))


# ==========================================================================
# 1. size() — cq.py:358 `return len(self.objects)`. NOT a bounding box.
# ==========================================================================
cap("G4 empty.size()", lambda: cq.Workplane("XY").size())
cube = cq.Workplane("XY").box(1, 1, 1)
cap("G4 cube.size()", lambda: cube.size())
cap("G4 cube.faces('>Z').size()", lambda: cube.faces(">Z").size())
cap("G4 cube.faces('>Z').edges().size()", lambda: cube.faces(">Z").edges().size())
cap("G4 cube.faces('>Z').vertices().size()", lambda: cube.faces(">Z").vertices().size())
# A solid's Size() is a 3-tuple — the confusion that made faijs's `size` wrong.
cap("G4 cube.val().BoundingBox().xlen", lambda: round(cube.val().BoundingBox().xlen, 6))
cap("G4 cube.val().Size()", lambda: tuple(round(x, 6) for x in cube.val().Size()))

# ==========================================================================
# 2. pushPoints -> multi-point stack; val() is the FIRST object (cq.py:411)
# ==========================================================================
pp = cq.Workplane("XY").pushPoints([(-0.3, 0.3), (0.3, 0.3), (0.0, 0.0)])
cap("pp.size()", lambda: pp.size())
cap("pp.vals() types", lambda: types(pp.vals()))
cap("G1 pp.val() center", lambda: (
    lambda c: "(%.6f,%.6f,%.6f)" % (c.x, c.y, c.z)
)(pp.val().Center()))
cap("pp.vals()[1] center", lambda: (
    lambda c: "(%.6f,%.6f,%.6f)" % (c.x, c.y, c.z)
)(pp.vals()[1].Center()))
# G1: empty stack -> val() returns plane.origin, a Vector, NOT None.
cap("G1 empty.val()", lambda: type(cq.Workplane("XY").val()).__name__)
cap("G1 empty.val() toTuple", lambda: tuple(
    round(x, 6) for x in cq.Workplane("XY").val().toTuple()))
cap("G2 empty.vals()", lambda: cq.Workplane("XY").vals())

# ==========================================================================
# 3. all() — cq.py:346 `[self.newObject([o]) for o in self.objects]`
#    Returns WORKPLANES (one per object), not Shapes.
# ==========================================================================
cap("pp.all() len", lambda: len(pp.all()))
cap("pp.all()[0].vals()", lambda: types(pp.all()[0].vals()))
cap("pp.all()[1].vals()", lambda: types(pp.all()[1].vals()))
cap("pp.all() is Workplane", lambda: type(pp.all()[0]).__name__)
cap("pp.all() plane origin preserved",
    lambda: tuple(round(x, 6) for x in pp.all()[0].plane.origin.toTuple()))

# ==========================================================================
# 4. first / last / item — cq.py:644 / 661 / 653
# ==========================================================================
cap("pp.first().vals()", lambda: types(pp.first().vals()))
cap("pp.last().vals()", lambda: types(pp.last().vals()))
cap("pp.item(0).vals()", lambda: types(pp.item(0).vals()))
cap("pp.item(2).vals()", lambda: types(pp.item(2).vals()))
cap("pp.item(-1).vals()", lambda: types(pp.item(-1).vals()))
cap("pp.item(-3).vals()", lambda: types(pp.item(-3).vals()))
cap("pp.first().val() center == pp.val() center",
    lambda: tuple(round(x, 6) for x in pp.first().val().Center().toTuple())
    == tuple(round(x, 6) for x in pp.val().Center().toTuple()))
cap("OOB pp.item(9)", lambda: types(pp.item(9).vals()))
cap("OOB pp.first() on empty", lambda: cq.Workplane("XY").first().vals())

# ==========================================================================
# 5. end() — cq.py:669. Walks the PARENT chain, not the stack.
# ==========================================================================
cap("end() on root raises", lambda: cq.Workplane("XY").end())
cap("cube.end() is root", lambda: types(cq.Workplane("XY").box(1, 1, 1).end().objects))
cap("chained .end(2)", lambda: types(
    cq.Workplane("XY").box(1, 1, 1).box(2, 2, 1).end(2).objects))
# The documented idiom: .faces("+Z").tag(..).end() jumps back to the face node.
b = cq.Workplane(origin=(0, 0, 1)).box(2, 2, 2).faces("<Z").tag("box2_face").end()
cap("tag().end() size", lambda: b.size())
cap("tag().end() face area", lambda: round(b.faces("<Z").val().Area(), 6))
# end() too far raises ValueError (cq.py:669-686)
cap("end(99) raises", lambda: cq.Workplane("XY").box(1, 1, 1).end(99))

# ==========================================================================
# 6. add() — cq.py:387. APPENDS (faijs's P3-0 `add` REPLACED instead).
#    Three branches: list -> extend, Workplane -> extend + mergeTags,
#    single object -> append. Returns self (in-place upstream).
# ==========================================================================
a1 = cq.Workplane("XY").box(10, 20, 30)
a2 = cq.Workplane("YZ").box(10, 20, 30)
cap("add(list) size", lambda: len(a1.add(a2.vals()).objects))
cap("add(Workplane) size", lambda: len(cq.Workplane("XY").add(a2).objects))
cap("add(list) types", lambda: types(cq.Workplane("XY").add(a2.vals()).objects))
# The upstream test that a REPLACING add would silently fail (test_cadquery.py:2447)
s = cq.Workplane("XY").box(10, 10, 10)
s1 = s.add(s.faces("+Y")).add(s.faces("+X"))
cap("add(f1).add(f2) size", lambda: s1.size())
cap("add(f1).add(f2) types", lambda: types(s1.vals()))
cap("add(f1).add(f2) areas",
    lambda: [round(o.Area(), 4) for o in s1.vals()])
cap("add(f1).add([f2]) size", lambda: s.add(s.faces("+Y")).add([s.faces("+X")]).size())
cap("add on empty", lambda: cq.Workplane("XY").add(a2.val()).size())
# mergeTags: add() carries tags across
tg = cq.Workplane("XY").box(1, 1, 1).tag("T")
cap("add merges tags", lambda: "T" in cq.Workplane("XY").add(tg).tags)

# ==========================================================================
# 7. findSolid() — cq.py:721. Searches the stack then the parent chain.
#    G3: multiple Solids found are RE-COMBINED into one compound (1 object);
#    every other kind returns rv[0] (the first).
# ==========================================================================
cap("findSolid on cube", lambda: cube.findSolid().ShapeType())
cap("G3 two solids -> size()", lambda: len(cq.Workplane("XY")
                                          .box(1, 1, 1).solids().objects))
# _findType asymmetry: solids() on a 2-solid compound yields ONE compound,
# while faces() on the same compound yields N objects.
two = cq.Workplane("XY").box(1, 1, 1).faces(">Z").workplane(-0.5) \
    .split(keepTop=True, keepBottom=True)
cap("G3 split stack size", lambda: two.size())
cap("G3 split.solids().size()", lambda: two.solids().size())
cap("G3 split.solids().val().ShapeType()", lambda: two.solids().val().ShapeType())
cap("G3 split.faces().size()", lambda: two.faces().size())
cap("G3 split.item(0).faces().size()", lambda: two.item(0).faces().size())
cap("G3 split.item(1).faces().size()", lambda: two.item(1).faces().size())
cap("G3 split end() -> root untouched", lambda: types(
    cq.Workplane("XY").box(1, 1, 1).faces(">Y").workplane(-0.5)
    .split(keepTop=True, keepBottom=True).end().objects))
cap("findSolid on empty raises", lambda: cq.Workplane("XY").findSolid())
cap("findSolid through a face selection",
    lambda: cq.Workplane("XY").box(1, 1, 1).faces(">Z").findSolid().ShapeType())

# ==========================================================================
# 8. filter / map / sort — cq.py:4460 / 4470 / 4490. All go through
#    newObject, so they RETURN A NEW WORKPLANE and keep the parent link.
# ==========================================================================
multi = cq.Workplane("XY").pushPoints([(-1, 0), (0, 1), (1, 0), (2, 0)])
cap("filter(odd x).size()",
    lambda: multi.filter(lambda o: abs(o.Center().x) > 0.5).size())
cap("map(vals types)", lambda: types(
    multi.map(lambda o: o).objects))
cap("sort by -Volume first", lambda: round(
    cq.Workplane("XY").box(1, 1, 1).box(2, 2, 2)
    .sort(lambda s: -s.Volume())[0].val().Volume(), 6) if False else "n/a")
# Upstream test_cadquery.py:5788 sorts a 3-box stack and reads [-1].
boxes3 = (cq.Workplane("XY").pushPoints([(0, 0), (10, 0), (20, 0)])
          .box(1, 1, 1, combine=False)
          .val())
cap("sort by -Volume", lambda: round(
    cq.Workplane("XY").pushPoints([(0, 0), (10, 0), (20, 0)])
    .box(1, 1, 1).box(3, 3, 3).box(2, 2, 2)
    .sort(lambda s: -s.Volume())[-1].val().Volume(), 6))
# apply(): f(list) -> list, ONE call for the whole stack
cap("apply(identity) size", lambda: multi.apply(lambda objs: list(objs)).size())
cap("apply(dedup 1) size", lambda: multi.apply(lambda objs: objs[:1]).size())
# invoke() (cq.py:4500) — returns self when the callable returns None
cap("invoke(none) size", lambda: multi.invoke(lambda w: None).size())

# ==========================================================================
# 9. NESTED narrowing — the reason P3 exists. cq.py:227 _collectProperty
#    unions the sub-shapes of EVERY object on the stack, so
#    .faces(">Z").vertices("<XY") must see only THAT face's vertices.
# ==========================================================================
cap("single: cube.faces('>Z').vertices().size()",
    lambda: cube.faces(">Z").vertices().size())
cap("single: cube.faces('>Z').faces().size()", lambda: cube.faces(">Z").faces().size())
# A 2-solid stack: each solid contributes its own top face + vertices.
two_solids = (cq.Workplane("XY").box(1, 1, 1).faces(">Z").workplane(-0.5)
              .split(keepTop=True, keepBottom=True))
cap("stack2: .faces('>Z').size()", lambda: two_solids.faces(">Z").size())
cap("stack2: .faces('>Z').vertices().size()",
    lambda: two_solids.faces(">Z").vertices().size())
cap("stack2: .faces('>Z').edges().size()",
    lambda: two_solids.faces(">Z").edges().size())
# Contrast: the SAME narrowing applied to the single-solid case
cap("single: hole faces('>Z').wires().size()",
    lambda: cq.Workplane("XY").box(20, 10, 2).faces(">Z").workplane()
    .hole(4).faces(">Z").wires().size())
# The 3-box case from test_cadquery.py:167 — combine() then size()
comb = cq.Workplane("XY").pushPoints([(-1, 1), (1, 1), (0, -1)]) \
    .circle(0.5).extrude(1).combine()
cap("testCylinderPlugin: size()", lambda: comb.size())
cap("testCylinderPlugin: val().ShapeType()", lambda: comb.val().ShapeType())
cap("testCylinderPlugin: solids().size()", lambda: comb.solids().size())
cap("testCylinderPlugin: faces().size()", lambda: comb.faces().size())

for name, value in out:
    print("%-44s = %s" % (name, value))
