# Agent Note: FCStd bspline knot expansion + construction geometry — the fillet edgeRef failure

Status: implemented

English | [中文](2026-09-27-fcstd-bspline-knots-and-construction-geometry.zh.md)

## Problem

`Mannequin_mp-dummy-1850mm-standing-000.FCStd` converts, but the isolated `Body022`
product failed at run time:

```
cad.fillet(Groove032, { edges: [cad.edgeRef(Groove032, 2)], radius: 6 })
→ edgeRef: edge 2 has 1 adjacent face(s); an EdgeTopoRef needs a two-face pair
```

FreeCAD's `Fillet032` `Base` is the LinkSub `Groove032 + Edge2` (Document.xml), so the
converter faithfully emitted `cad.edgeRef(Groove032, 2)`. The engine's own `Groove032`
(= `subtract(Revolution040, groove-sphere)`) had **13 faces / 30 edges** with ordinal 2
on a 1-adjacent-face seam edge, while FreeCAD's shape has Edge2 on an ordinary
two-face edge — the edge **ordinal** disagreed because the **geometry** disagreed.

Root cause A (the reported bug): `Sketch075` carries six radius-1 circles that are
FreeCAD **construction** geometry — internal-alignment/marker circles sitting on the
profile vertices. They are flagged only through the modern
`<GeoExtension type="Sketcher::SketchGeometryExtension" geometryModeFlags="…"
internalGeometryType="9"/>`, not the legacy `<Construction value="1"/>` sibling that
`sketch-parse.ts` looked for. `Document.xml` in this corpus contains **zero**
`<Construction>` elements, so the markers leaked into the profile, the revolved solid
gained extra faces/edges, and FreeCAD's `Edge2` landed on a seam edge.

Fixing that leak **regressed the whole corpus** (139 translated / 0 gaps → 85 / 54
gaps, `ok:false`). The leak had been masking two further, independent defects:

Root cause B — knot multiplicity dropped. `sketch-parse.ts` read the knot multiplicity
from attribute `Multiplicity`; FCStd writes **`Mult`** (a 500-file corpus scan found
`Mult` on 3190/3190 `<Knot>` elements, never `Multiplicity`). Every knot vector was
therefore collapsed to its **distinct** values (length ≪ poles + degree + 1), and
`bspline.ts` evaluated a dimensionally-invalid vector: for `length < degree + 2` it
silently degenerated to the control polygon (whose endpoints coincide with the poles,
so short splines *looked* correct); otherwise `evalBSpline` clamped the whole domain to
a single parameter and returned a degenerate proxy. The marker circles had been
supplying spurious self-closed contours that satisfied `extractContours`; once filtered,
line+spline profiles produced **zero** loops and their Revolution/Groove/Pad consumers
cascaded to `sketch-solved-no-closed-loop` / `*-missing-base`.

Root cause C — right-boundary span search. With knots expanded, `evalBSpline`'s span
search `knots[k] <= u < knots[k+1]` never matches at `u === hi`, so it fell through to
its `k = degree` default — the **first** span — and extrapolated off the leading control
polygon. `sampleBSpline` samples `t = hi` exactly as its last point, so every spline's
proxy **end** jumped off the curve (Sketch075: last sample `(620.5, 385.9)` instead of
the pole `(15.9, 0)`) and `extractContours` could not close the chain. Every existing
test used a **single-span** spline (`poles.length === degree + 1`), where the last span
index equals `degree` — exactly the old default — so the bug was invisible.

## Decision

Three fixes, one per root cause, all in the read/flatten layer (no engine change):

1. **Construction geometry is read from every encoding** (`packages/fcstd/src/sketch-parse.ts`).
   `isConstructionGeometry(child)` honors (a) the legacy `<Construction value≠0/>`
   sibling and (b) the modern `<GeoExtension>` `internalGeometryType ≠ 0` (BSpline
   control/knot points, diameter helpers) and `geometryModeFlags` **bit 1**
   (`GeometryMode { Blocked = 0, Construction = 1 }`, indexed from the right).
   `extractContours` already filtered on `g.construction`; only the parse side needed
   fixing.
2. **Knot multiplicity is read from `Mult`** (`sketch-parse.ts`), with `Multiplicity`
   kept as a fallback for hand-written fixtures. The expanded (clamped) knot vector is
   what `BSplineCurveData.knots` documents and what `bspline.ts` assumes, so the parse
   layer is the single place to expand it.
3. **`evalBSpline` spans the right boundary correctly** (`packages/sketch/src/bspline.ts`):
   default `k` is the last span `n - 1` (not `p`), so `t = hi` evaluates the final pole.
   The default is only reached at the boundary; the interior search is unchanged.

## Alternatives considered

- **Relax `JOIN_TOL` in `extractContours`.** Rejected: the join failure was not a
  tolerance artifact — the proxy end was tens of millimetres off the pole. Widening the
  tolerance would have "closed" loops between unrelated points.
- **Keep honoring only the legacy `<Construction/>`.** Rejected: that is the reported
  bug; the marker circles stay in the profile and edge ordinals stay wrong.
- **Special-case radius-1 circles in `contour.ts`.** Rejected: heuristic on a shape
  property instead of reading the construction *semantic*, and it would also drop
  legitimate small circles.
- **Expand the knot vector inside `bspline.ts`.** Rejected: `knots` is contractually the
  expanded clamped vector and the parsed geometry also feeds the solver; expanding in the
  parser keeps one source of truth.
- **Guard `knots.length < p + 2` harder instead of fixing the boundary.** Rejected: that
  fallback is for genuinely degenerate input; real multi-span splines need a real
  evaluation.

## Consequences

- `Body022` runs: `{"ok":true,"checkErrors":[],"threw":false}`, STEP exported (1097 entities).
- The 10-file `Mannequin_mp` family converts clean again — 9 × 139 + 1 × 88 translated,
  **0 gaps**, matching the pre-fix baseline but with correct geometry.
- Spline profiles now carry the properly flattened polyline (19–37 line segments for the
  Sketch061/062/075 family) rather than a control-polygon or degenerate proxy, so every
  spline sketch gains fidelity, not only the ones that used to gap.
- The construction filter is a corpus-wide behaviour change: any sketch whose "closed
  loop" was previously made of construction markers now correctly reports
  `sketch-solved-no-closed-loop` unless its real geometry closes. That is the intended
  signal, and it is what surfaced root cause B.

## Verification

- Regression tests added:
  - `packages/fcstd/src/bspline.test.ts` — `Mult` fixtures, a multi-span
    `evalBSpline(d, hi) === last pole` case, a multi-span `sampleBSpline` end case, and a
    `Multiplicity` fallback case.
  - `packages/fcstd/src/construction-geometry-gotcha.test.ts` — modern
    `geometryModeFlags` bit 1 / `internalGeometryType` mark construction, and
    construction circles are excluded from contours.
- Suites: `packages/fcstd` 22 files / 248 tests pass; `packages/sketch` pass;
  `packages/tests faijs/sketch-constraint faijs/edge-ref` 17 tests pass.
- Typecheck: `packages/fcstd` and `packages/sketch` `tsc --noEmit` exit 0.
- End-to-end: isolated `Body022` on the BREP path via `tools/run-sweep-worker.ts` returns
  `ok` with an exported STEP; family convert scan → 10/10 `ok`, 0 gaps.
