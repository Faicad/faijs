# Agent Note: fai_cq_gears ports BevelGearPair (assembly placement chain, reference cases created from cq)

Status: implemented

English | [中文](2026-09-12-fai-cq-gears-bevel-pair-port.zh.md)

## Problem

`fai_cq_gears` had ported all nine single-body gear classes, including `BevelGear` in the same session. The remaining shape class from the port plan (§8.4) is the **gear pair**: `BevelGearPair` assembles two bevel singletons into a meshing set whose pinion must be rotated about the intersection point of the two axes. Two things made it more than a wrapper:

- **No upstream reference data.** cq_gears ships regression cases only for the single-body classes, so the port plan (§9.4) requires **creating** reference cases for the pair classes. That means extending the reference generator with a pair-aware path that records per-member ground truth.
- **The placement chain is not self-evident.** `BevelGearPair.assemble()` composes four `cq.Location` objects with `*=`, and CadQuery's `Location` semantics for both composition order and the meaning of the `(t, ax, angle)` overload had to be pinned down by measurement rather than recalled.

## Decision

- **New module `src/pairs.ts`.** `bevelPairConeAngles()` divides the axis angle between the two members (`delta_gear = atan(sin A / (z_pinion/z_gear + cos A))`, and the reciprocal for the pinion); `buildBevelGearPair()` builds both members through the existing `buildBevelGearSolid`; `placePinion()` applies the placement chain; `bevelPairExportParts()` yields one named entry per member for `exportStepFromSolids`.
- **Placement semantics measured, not assumed** (probe against the installed CadQuery, recorded in `docs/analysis/2026-09-12-fai-cq-gears-bevel-precision.md` §6.4): `cadquery/occ_impl/geom.py`'s `Location(t, ax, angle)` builds `gp_Ax1(Vector(0,0,0), ax)`, so the pivot is **always the origin** and `t` is purely the translation part; and `Location.__mul__` composes **right-to-left**. Therefore `loc = A*B*C` is applied **C → B → A**, i.e. rotate about Z by `π/z` (only when the pinion tooth count is even), translate by `-pinion.cone_h` in Z, rotate about Y by the axis angle through the origin, translate by `+gear.cone_h` in Z.
- **Upstream asymmetries copied verbatim, not "fixed".** `BevelGearPair.__init__` passes `clearance` to the gear but **not** to the pinion (it falls back to 0.0), and negates the helix angle for the pinion. Both are reproduced exactly.
- **Reference generation extended, not forked.** `gen-reference.py` gains `--set pairs` and a `build_pair_case()` path that records, per member, the volume/bbox/bbox_min/bbox_max/center **in assembly pose**, plus `z`/`cone_h`/`cone_angle_deg`/`gs_r`/`surface_splines`, plus the `assembly` block. Tooth-face grids are skipped with an explicit reason (`tooth_face_grids_skipped`) because a pair has no single `twist_angle`.
- **Three new cases** cover the three placement branches: `bp-basic` (odd pinion → no Z rotation), `bp-even-pinion` (even pinion → Z rotation), `bp-angled-helix` (60° axis + 20° helix → non-90° axis and the negated pinion helix).
- **One mapping, one home.** `args → build options` extraction was duplicated between the exporter and the tests, and that duplication caused two false 2%-volume alarms in one day (a test omitted `bore_d` and compared our bore-less body against a bored reference). It now lives only in `src/testing/reference-options.ts`, shared by `export-ours.ts` and both bevel test suites.

## Alternatives considered

- **Return a single fused/compound solid from the pair builder.** Rejected: the reference is a compound of two independent products (`MANIFOLD_SOLID_BREP` count 2), and `compareAssemblyFiles` deliberately distinguishes "2 parts" from "1 compound with 2 solids", so the pair must stay two export entries.
- **Replicating the placement as a single 4×4 matrix built by hand.** Rejected: `placePinion` composes the same four kernel operations in the same order the Python applies them, which keeps the code auditable against `assemble()` line by line; a hand-rolled matrix would have to re-derive the same order anyway, with no benefit.
- **Colouring the two members with cq's `goldenrod`/`lightsteelblue`.** Rejected after measuring: `assemble()` assigns those colours to the `cq.Assembly`, but `_build()` returns `asm.toCompound()`, which drops them — the reference STEP contains **no** `COLOUR_RGB`. Colourless B output is what makes the two sides comparable.
- **Reusing `merge-bevel-reference.ts` for the new cases.** Rejected: it is hard-wired to one class and one source directory. It is replaced by the general `scripts/merge-reference.ts` (`--from <dir> --class <name|all>`), which merges by id, preserves existing entry order, and copies the STEP files.

## Consequences

- **T1 passes.** `bevelPairOptionsFromArgs`-driven builds run in the package suite for `bp-basic` (35 s) and `bp-angled-helix` (23 s); per-member volume (relative 1e-3) and bbox (absolute 1e-3) assertions pass. Overall pair volumes measured by the exporter: `bp-basic` 8.07e-7, `bp-even-pinion` 7.86e-7, `bp-angled-helix` 5.29e-6 relative.
- **T2 still reports DIFFERENT, for exactly one reason, reported not loosened.** Full-precision per-member metrics show every criterion inside tolerance except the volume relative term: structure 2 vs 2, colours match, centre-of-mass difference ≤ 2.02e-5, bbox difference ≤ 3.61e-4 (both against `linearTolerance = 1e-3`, 30× margin), while per-member volume relative difference is 1.739e-6 / 1.652e-6 / 1.415e-5 / 2.461e-6 against the `1e-6` threshold — i.e. 1.7× to 14× over, with the `surface_splines = 12` case worst and the two spur-toothed cases at 1.7×, matching the tooth-surface approximation root cause established for `BevelGear`.
- `bp-angled-helix` additionally fails the overall boolean check (`A−B = 0`, `B−A = −1.319` against a `1.814e-3` tolerance). A negative difference volume means `BRepAlgoAPI_Cut` returned an inverted solid — the known occt-wasm near-coincident B-spline boolean defect, not a modelling error, since the same dataset gives `A−B` of exactly 0 and per-member centre-of-mass agreement of 2.0e-5.
- Face counts differ between the two sides (e.g. gear 183 vs 185, angled gear 125 vs 101) and are excluded from the verdict by `strictTopology: false`, consistent with the existing calibration for B-spline surfaces.
- The three reference STEP files add 6.3 MB (1.90 / 1.94 / 2.48 MB); the reference directory was already 118 MB, so this follows the established practice of committing full reference data for a ported class.
- **Threshold follow-up.** The volume tolerance decision still pending for `BevelGear` now also covers this class: at `1e-5` the three spur-toothed members pass outright and `bp-angled-helix` needs `2e-5`; at the current `1e-6` all nine Bevel-family cases remain known deviations. The analysis document records both readings and neither threshold was changed.
