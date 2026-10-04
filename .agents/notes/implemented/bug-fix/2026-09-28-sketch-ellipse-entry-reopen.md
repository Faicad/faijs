# Agent Note: Reopen the ellipse kind at the cad.sketch entry

Status: implemented

English | [中文](2026-09-28-sketch-ellipse-entry-reopen.zh.md)

## Problem

The canonical sketch schema reserved `point` / `ellipse` / `bspline`, and
`toFreeCadGeoms` rejected all three with `E_SKETCHC_UNSUPPORTED_GEOM` — yet the
downstream chain already consumed them: `planegcs-backend.ts` pushes/pulls
ellipse primitives (center + focus1 + radmin) and standalone points, and
`contour.ts` samples bsplines and emits 64-chord closed ellipse contours. The
op-entry schema was narrower than the solver chain, so every FCStd corpus
product containing an ellipse sketch failed at run time with an error the
solver was never actually going to hit (fcstd-port P2-1 class:
`E_SKETCHC_UNSUPPORTED_GE`, 5+ corpus files).

## Decision

Reopen `ellipse` only. `toFreeCadGeoms` now projects the canonical ellipse
(`cx/cy/rx/ry/angle`, angle in radians) to the FCStd record
(`majorRadius/minorRadius/angleXU` plus the computed focus pair, mirroring what
FreeCAD stores). The canonical type itself was unchanged — it already declared
the ellipse variant. `point` and `bspline` stay reserved: `point` has no
profile use (contours skip standalone points) and bspline-through-the-op needs
a segment-decision first, while the translator already lowers bsplines to
polylines upstream.

## Alternatives considered

- **Translator-side polyline lowering for ellipses** (as done for bsplines):
  rejected — it degrades exact geometry in the produced script when the exact
  path exists end to end.
- **Reopen `point`/`bspline` too**: rejected for now — no consumer need for
  canonical standalone points, and bspline constraint projection needs its own
  design round.

## Consequences

- Ellipse sketches now solve and produce closed contours end to end;
  regression coverage lives in `packages/sketch/src/ellipse-sketch-e2e.test.ts`
  (projection foci, canonical round-trip, contour extraction) and the updated
  GOTCHA in `op-entry-schema-gotcha.test.ts` (which now asserts ellipse is
  accepted, with the rejection history in comments).
- `E_SKETCHC_UNSUPPORTED_GEOM` remains reachable only via `point`/`bspline`.
- The fcstd-port corpus stage2 failures of this class should drop once the
  next 0.21.x tgz is installed there (P0-3 version-lock discipline applies).
