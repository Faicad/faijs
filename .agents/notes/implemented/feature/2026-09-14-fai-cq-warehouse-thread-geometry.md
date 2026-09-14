# Agent Note: fai_cq_warehouse W3 threads — ruled-loft bands, tessellation-volume baseline, calibrated tolerances

Status: implemented

English | [中文](2026-09-14-fai-cq-warehouse-thread-geometry.zh.md)

## Problem

`@faicad/fai-cq-warehouse` ports the `cq_warehouse` CadQuery library to TypeScript. W3 is the Thread module: five classes (`Thread`, `IsoThread`, `AcmeThread`, `MetricTrapezoidalThread`, `PlasticBottleThread`) whose geometry is a helical ribbon bounded by four ruled bands plus end caps — built upstream from `Wire.makeHelix` / `Workplane.parametricCurve` and `Face.makeRuledSurface`, none of which exist in `occt-wasm` / `BrepEngineApi`. Four separate traps surfaced while implementing the `simple=False` (real helical surface) path:

1. **`bsplineSurface` is an approximation, not an interpolation, and it systematically overshoots.** The first implementation of a ruled band was `bsplineSurface([...rowA, ...rowB], rows = 2, cols = N)`. With both rows sampled at exactly `r = 3.000000000`, the resulting face measured `xmax = 3.000369534` (Δ = 3.70e-4), and the error **does not shrink with sampling density** (per-turn 12 → 192 all converge to 3.699e-4) nor with `rows` (2/3/5/9 identical). On a Ø6 thread that is a 0.37‰ radial error — enough to blow through a 1e-3 bbox gate.
2. **`BRepGProp`'s exact surface integration aliases on helical B-spline faces.** The upstream Thread solid reports `Volume() = 49.961532` while its own tessellation reports `43.680000` — 14% apart. The tessellated value is the true one: it converges across deflections (0.05 → 0.0005), agrees with an independent Pappus/helical-sweep derivation (43.693848), and the GProps value is additionally non-monotonic in length (L=10 → 34.97, 11 → 49.96, 12 → 39.18) and non-additive under a boolean split (31.284 + 34.002 ≠ 49.962).
3. **`Shape.BoundingBox()` reads a coarse triangulation if one exists.** `gen-reference.py` computed `volume_mesh` (which calls `tessellate`, mutating the shape in place) *before* `bbox`, and cadquery's `BoundingBox()` uses `BRepBndLib::AddOptimal(..., useTriangulation=True)`. Every reference bbox in the manifest was therefore inflated (e.g. HexNut 11.560587 instead of 11.545005; `thread-generic` 6.012626 instead of 6.000001).
4. **`compareAssemblyFiles` judges volume and center of mass through that same GProps integration.** Its sole knobs are `linearTolerance` (shared by bbox *and* CoM) and `volumeRelativeTolerance`, so neither trap can be expressed as a per-criterion tolerance.

## Decision

### Ruled bands go through `approximatePoints` + `loft(ruled)`

`primitives.ruledFace` builds each band as two single-edge wires (`makeWire([approximatePoints(row, 1e-6)])`) ruled together with `loft([wireA, wireB], isSolid = false, ruled = true)`, then extracts the single face via `getSubShapes(shape, 'face')`. On the same point set this gives `xmax = 3.000000982` (Δ = 9.8e-7) — **375× tighter** than `bsplineSurface`. Fallback is not silent: a non-1 face count throws.

### Volume baseline is the tessellation, not GProps

`gen-reference.py` records both `volume` (GProps) and `volume_mesh` (tessellation, deflection 0.002 / angular 0.1 — the same parameters cadquery's `Shape.tessellate` uses); `primitives.meshVolume` computes the B-side counterpart by signed-tetrahedron summation over `kernel.tessellate`. Manifest-driven comparisons judge on `volume_mesh`. `volumeOf` (GProps) is kept as a reported diagnostic only.

### Reference bboxes are measured exactness-first

`bbox_of` / `part_info` call `BRepBndLib.AddOptimal_s(shape, box, False, False)` explicitly (decoupled from tessellation state), and `volume_mesh` is computed last in `build_case`. `primitives.bboxOf` keeps the kernel default (`useTriangulation = false`).

### Tolerances are calibrated per class, with a reverse guard

`src/testing/compare.ts` owns all tolerances. The thread family gets a single override — `volumeRelativeTolerance` 1e-6 → 1e-4 (measured worst 2.289e-5 × 4.4). `linearTolerance` is **not** relaxed (measured worst bbox 8.74e-7, margin 1144×), and global defaults are untouched. The one case that still reports DIFFERENT is classified, not tolerated: `KNOWN_A_SIDE_COM_ARTIFACTS` plus `classifyKnownArtifact()` mark it as a known **A-side measurement** artifact only when structure matches, volume and bbox both pass, and the sole failing criterion is the center of mass.

## Evidence

Importing both STEPs into the same kernel and measuring twice:

| quantity | A side | B side |
|---|---|---|
| GProps CoM x (`iso-m10x1.5-fade-square`) | +0.143267 | −0.007574 |
| **tessellated** CoM x, same case | −0.006756 | −0.006787 (Δ = 4.4e-5) |
| GProps volume | 194.521596 | 194.519895 |
| tessellated volume | 194.606211 | 194.607034 |

A side's GProps CoM contradicts A side's own tessellated CoM by 0.15 mm, while B agrees with A's tessellation to 4.4e-5 — so the outlier is the measurement, not the geometry. Full sweep (per-case bbox/volume/CoM plus the arbitration data and reproducibility commands) is in `docs/analysis/2026-09-14-cq-warehouse-thread-probe.md`.

After the fixes, the STEP equivalence sweep is 17/17 (16 EQUIVALENT + 1 classified artifact); worst per-metric deviation is bbox 8.744e-7 mm, volume 2.289e-5 relative, CoM 1.520e-4 mm.

## Known gaps

- `end_finishes = "chamfer"` is **not implemented**. Upstream applies an asymmetric `chamfer(0.5·tooth_height, 0.75·tooth_height)` with a `RadiusNthSelector` edge pick; this kernel only exposes single-distance chamfer. `buildThread` throws explicitly (with a pointer to the analysis doc) rather than approximating, and no chamfer case is present in the reference set — a coverage assertion enforces that absence so the gap cannot be silently skipped.
- Two upstream bugs are reproduced verbatim and asserted: `square_off_ends` uses the incoming object as the base of each cut (so `("square","square")` only trims the `z > length` side), and `PBT_FINISH_DATA[200]` keeps the malformed diameter list `[24.28]` that makes `M200SP444` invalid.

## Alternatives considered

- **Keep `bsplineSurface` and record a known radial deviation.** Rejected: the deviation is a construction artifact of the chosen primitive, not a method difference, and a tighter primitive exists. The old path also consumed the entire bbox margin (worst 9.9e-2).
- **Judge volume by GProps on both sides and relax `volumeRelativeTolerance` to ~2e-4.** Rejected: it would encode a broken measurement as the contract. The measured mesh-vs-mesh difference (2.289e-5) is an order of magnitude smaller and is backed by two independent arbiters.
- **Raise `linearTolerance` for the thread family so the artifact case passes.** Rejected outright: bbox and CoM share that knob, so it would silently relax the bbox gate (measured 8.74e-7) by five orders of magnitude — precisely the "relax in place to erase a FAIL" red line.
- **Re-implement the ruled band as a `sweep` or as a grid of intermediate rows.** Not pursued: `loft(ruled)` already reaches 9.8e-7, and a grid approximation would re-introduce a fitting error in the second direction.

## Consequences

- `simple = False` is viable for all four end-finish combinations except `chamfer`; W4–W7 can reuse `ruledFace` / `solidFromFaces` / `meshVolume` unchanged.
- The kernel-contract test now pins three behaviours so a kernel upgrade cannot regress them silently: `loft` between multi-edge wires yields one face per edge pair (single-edge wires yield exactly one), `tessellate` preserves face orientation (box mesh volume is +8), and `getBoundingBox(shape, true)` inflates bounds while the default does not.
- Every later stage inherits the ordering rule "measure bbox/CoM before tessellating" and the rule "do not use GProps as the sole volume judge on helical or near-coincident B-spline geometry".
- The reference generator changed, so the manifest was regenerated for both the smoke and thread sets — the earlier W1/W2 values for bbox were never trustworthy.
- `npx tsc --noEmit` for this package now reports one pre-existing error in `packages/cq-compat/src/workplane.ts:4548` (the erased `kernel.brep` typing). This is not new: `packages/fai_cq_gears` and `packages/cq-compat` itself report the identical error under their own tsconfigs. Importing `@faicad/cq-compat` in tests merely exposes it.
