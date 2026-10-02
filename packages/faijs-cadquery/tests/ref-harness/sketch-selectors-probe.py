"""One-shot CadQuery 2.8.0 reference capture for the 2D sketch string selectors.

NOT part of CI and NOT re-run per test (audit §5.1). Truth is frozen into
packages/faijs-cadquery/src/sketch-selectors.test.ts.

Run with the OCP-enabled interpreter:
  & pwsh -NoProfile -Command "& 'C:/Users/ylt/cadquery-env/Scripts/python.exe' \
      'packages/faijs-cadquery/tests/ref-harness/sketch-selectors-probe.py'"

Covers the E-class gap (audit §3.5): Sketch.faces/wires/edges/vertices(sel)
dispatch to the very same cadquery.selectors.StringSyntaxSelector used by the 3D
Workplane selectors, so the sketch-side hand-rolled `applyStringSelector` has to
agree with `Center()` (type-dispatched mass centre) and with the 1e-4 cluster
tolerance of `_NthSelector`.

FIXTURES ARE BUILT FRESH FOR EVERY SELECTION: upstream mutates `Sketch._selection`
in place (`push()` leaves Locations there, `edges()`/`faces()` overwrite it), so a
reused sketch would resolve against the previous selection instead of the faces.
"""

import cadquery as cq


def bb_centre(s):
    bb = s.BoundingBox()
    return ((bb.xmin + bb.xmax) / 2.0, (bb.ymin + bb.ymax) / 2.0)


def f1():
    """Triangle + pushed rect: Center() ordering is the OPPOSITE of bbox-centre
    ordering along X (faces and wires)."""
    return cq.Sketch().polygon([(0, 0), (10, 0), (0, 4)]).push([(4.5, 8)]).rect(9, 4).reset()


def f2():
    """Quarter arc + straight segment: same flip for edges."""
    return cq.Sketch().arc((0, 0), 10, 0, 90).segment((6, 0), (6, 9))


def f3(dx):
    """Two 4x4 squares separated in Y, x-centres differing by `dx`."""
    return cq.Sketch().rect(4, 4).push([(dx, 10)]).rect(4, 4).reset()


def dump(title, build, kind):
    sk = build()
    fn = getattr(sk, kind)
    shapes = fn().vals()
    print("%-30s %d" % (title, len(shapes)))
    for s in shapes:
        c = s.Center()
        b = bb_centre(s)
        print(
            "    %-8s Center=(%.6f,%.6f) BBoxC=(%.6f,%.6f)"
            % (s.ShapeType(), c.x, c.y, b[0], b[1])
        )


def sel(title, build, kind, expr):
    sk = build()
    try:
        out = getattr(sk, kind)(expr).vals()
    except Exception as exc:  # noqa: BLE001 - the capture is diagnostic
        print("%-42s RAISES %s: %s" % (title, type(exc).__name__, exc))
        return
    names = ["%s@(%.5f,%.5f)" % (s.ShapeType(), s.Center().x, s.Center().y) for s in out]
    print("%-42s %s" % (title, ", ".join(names) if names else "(empty)"))


print("=== F1 · flip fixture (triangle + pushed rect) ===")
dump("F1 faces", f1, "faces")
dump("F1 wires", f1, "wires")
dump("F1 edges", f1, "edges")
dump("F1 vertices", f1, "vertices")
print()
for kind in ("faces", "wires", "edges", "vertices"):
    for tok in (">X", "<X", ">Y", "<Y"):
        sel('F1 %s("%s")' % (kind, tok), f1, kind, tok)

print()
print("=== F2 · arc vs segment (edges) ===")
dump("F2 edges", f2, "edges")
dump("F2 vertices", f2, "vertices")
print()
for tok in (">X", "<X", ">Y", "<Y"):
    sel('F2 edges("%s")' % tok, f2, "edges", tok)

print()
print("=== F3 · cluster tolerance 1e-4 (dx=5e-5 inside, 2e-4 outside) ===")
dump("F3(5e-5) faces", lambda: f3(0.00005), "faces")
print()
sel("F3(5e-5) faces('>X')", lambda: f3(0.00005), "faces", ">X")
sel("F3(5e-5) faces('<X')", lambda: f3(0.00005), "faces", "<X")
sel("F3(2e-4) faces('>X')", lambda: f3(0.0002), "faces", ">X")
sel("F3(2e-4) faces('<X')", lambda: f3(0.0002), "faces", "<X")
sel("F3(0) faces('>X')", lambda: f3(0.0), "faces", ">X")

print()
print("=== F4 · boolean composition (F1) ===")
for expr in (">X or <X", ">X and >Y", "not >X", ">X and <Y"):
    sel('F1 faces("%s")' % expr, f1, "faces", expr)
for expr in (">X or >Y", ">X and >Y", "not >Y"):
    sel('F1 vertices("%s")' % expr, f1, "vertices", expr)

print()
print("=== F5 · empty / single element ===")
sel("EMPTY faces('>X')", cq.Sketch, "faces", ">X")
sel("ONE faces('>X')", lambda: cq.Sketch().rect(2, 2), "faces", ">X")
sel("ONE vertices('<XY')", lambda: cq.Sketch().rect(2, 2), "vertices", "<XY")
