# Agent Note: FCStd port M11 — expression integration and asset closure (2026-09-17)

Status: implemented

English | [中文](2026-09-17-fcstd-m11-expressions-assets.zh.md)

## Decision 1: ExpressionEngine constant bindings override `<Float>` (M11.1)

`propNum()`'s read chain becomes: ExpressionEngine bound value first, falling back to the `<Float>` stored value when unavailable (no binding / binding for a different property). Rationale: FreeCAD recomputes bound properties from expressions at load time, so the stored value may be stale (test asserts stored=999, expr=10mm → takes 10).

**Caliber**: only bare constants (number + optional unit mm/cm/m/in/deg…) are evaluable (`evalConstantExpression`, implemented in M6.2); arithmetic containing identifiers (`2 * 5`) does not count as a constant — bake rather than evaluate.

## Decision 2: non-constant expressions explicitly baked (M11.2)

`hasNonConstantBinding()` checks Pad/Pocket's Length bindings; non-constant → bake with reason `pad|pocket-length-expression-non-constant`. No heuristic evaluation (§12).

## Decision 3: asset caliber (M11.3/M11.4, D-B landed)

- G7 test: `assets/` members and the assets entries in `mapping.json.artifacts` are **1:1** (bidirectional set equality), and byte-equal to the `freecad/` shadow members (.brp stored verbatim).
- G9: L1/L2 sketches land as `assets/<Sketch>.contour.json` (raw unsolved geometry + constraint table + fallback reason), registered in the mapping artifacts. **Measured: none of the three real samples (PadTest/Crank/ProjectTest) has L1/L2 Sketcher sketches** (Crank is all Part2DObjectPython/Part::Feature); the landing path is implemented by the conversion script and the mapping registration is wired, but real corpus triggers 0 contour assets (correct behavior) — this path is currently guarded by code path only, no real-sample assertion; add e2e when the corpus grows.

## GOTCHA

- `<ExpressionEngine>` parsing matches the property name by `Expression path="Length"`; the path may carry a leading dot (`.Length`), normalize before matching.
- Crank.fcstd's 16 baked objects are all `Part::Part2DObjectPython` / `Part::Feature` (Python lineage), not Sketcher sketches — do not mix them up when scanning/counting.

## Tests

- `feature-type.test.ts` +4 cases: constant overrides stored value, cross-object reference baked, Pocket identifier-arithmetic baked, `2 * 5` is not a constant
- `build-fai-zip.test.ts` +1 case: G7 assets 1:1 + byte equality
- fcstd 13 files / 97 cases + three e2e samples all green (baselines unchanged)
