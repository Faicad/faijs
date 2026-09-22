# Agent Note: FCStd port M13-w — Offset2D feasibility probe (candidate 1 judged infeasible, 2026-09-17)

Status: implemented

English | [中文](2026-09-17-fcstd-m13w-offset2d-infeasible.zh.md)

## Conclusion: candidate 1 (wire-offset unlocking the 22 `Part::Offset2D`s) cancelled

The probe (`scripts/probe-offset2d-feasibility.ts`, re-runnable) measured all 22 Offset2D instances (all in ArchDetail.FCStd):

- Source is always a Draft Wire (`Part::Part2DObjectPython` 19, `Part::Feature` 1, Rectangle 2)
- **wire vertex data is not in Document.xml**: the `Points` property has count=1 with no coordinate children (Draft geometry lives in a Python proxy object, serialization does not land in XML); `Part::Feature` has no Points property at all; Rectangle has no Points
- Fill=true dominates (22/22), Join is mixed (0/1/2), Mode mostly 0

## Why infeasible

The original plan's premise — "the conversion layer reads Points → offsets the polyline → produces cad.sketch" — does not hold: there are no readable polyline vertices in the properties. The remaining route is only "read the baked .brp → extract 2D edges via OCCT → offset → rebuild the contour", which is geometric reconstruction from BREP edge data whose reconstruction consistency cannot be validated against properties (conflicts with the V3 zero-silent-loss caliber). Per discipline (no guessing, no silent downgrade) it is judged infeasible; no implementation.

## GOTCHA

- Draft Wire / Part2DObjectPython's geometry properties (Points) are unreadable in the FCStd XML — when the scanner sees `Points count=1` with no children it is this shape; do not treat it as a single point.
- Offset2D's Fill=true means even a feasible offset would need to produce a face, not just a wire offset.

## Coverage follow-up candidates (updated order)

1. M13.3 external geometry full unlock (Drilling_1-like L2-prejudged sketches back to L1)
2. M10 leftover container loader (cross-file `<Body>_out` reference closure)
3. Offset2D: re-evaluate only if a future ".brp edge extraction + 2D offset rebuild" capability is introduced
