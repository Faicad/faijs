# Agent Note: FCStd port M13.3 — full external-geometry unlock (2026-09-17)

Status: implemented

English | [中文](2026-09-17-fcstd-m133-external-geo.zh.md)

## Change

The converter (`scripts/fcstd-to-fai-zip.ts`) drops the `external-geometry` L2 pre-judgement: sketches with external-geometry references now take M6.3's real resolution — the source object's .brp edges are extracted via OCCT, projected into the sketch-local 2D, and handed to the solver as immutable targets (geoId -3..-N). Only resolution failure (no usable link / unloadable source shape) bakes, with reason `external-geometry-unresolved: <first failure reason>`.

## Measured effect (Drilling_1.FCStd)

- Before: sketches with external geometry all L2-prejudged (the old behavior pinned by the M12.2b test)
- After: translated=17, sketches **L0=13** (external edges participate in solving and converge)
- The caliber gap between the locator (`locate-l1-sketches.ts`) and the converter is **eliminated** — the "same sketch graded differently on both sides" noted in M12.2b's GOTCHA no longer exists

## Test status

- fcstd 13 files / 102 cases all green
- G9 real-sample test (fcstd-g9-contour.test.ts) passes — Drilling_1 still contains an L2 sketch (the InternalAlignment×8 Sketch is an unsupported-constraint), contour.json landing + assets/mapping 1:1 assertions unchanged
- e2e three samples all green, baselines unchanged (none of the three samples' sketches reference external geometry; the path is unaffected)

## GOTCHA

- The `external-geometry` reason's semantics changed: in the pre-judgement era it meant "bake on seeing an external reference"; now it only appears on resolution failure (with the `-unresolved` suffix format). Tests asserting on the old reason must be updated in sync.
- External targets passed to the solver only take `polyline.length === 2` (two-point segments) — multi-point projections of curved edges do not enter the solver yet and fall to L1/L2 by delta.
