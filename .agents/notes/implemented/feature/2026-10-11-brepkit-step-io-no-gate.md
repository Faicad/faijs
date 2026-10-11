# Agent Note: brepkit STEP import/export without engine gates

Status: implemented

English | [中文](2026-10-11-brepkit-step-io-no-gate.zh.md)

## Problem

`cad.exportStep` and `cad.import_step` were hard-gated to the occt engine (`assertEngineFor('exportStep', ['occt'])`, `defineOp({ engines: ['occt'] })`, plus an `engineId !== 'occt'` throw in both `exportModelSync` and `exportModel` STEP branches). Under the brepkit engine every STEP call failed with `E_BREP_UNSUPPORTED` even though the brepkit kernel ships its own pure-Rust AP203 reader/writer (`importStep` / `exportStep` bindings, already wrapped in the faijs adapter at `brepkit-kernel/brepkitKernel.ts`).

User directive (2026-10-11, verbatim in `docs/plans/2026-10-11-brepkit-step-io.md`): no gates, no errors. Export follows brepkit's supported format; import treats unsupported features as at-most-a-warning, per brepkit's own implementation.

## Decision

STEP now dispatches by engine at the library layer with **no capability assertions**:

- `exportStep` / `exportModel:step`: `engineId === 'brepkit'` → new native channel `brep/export/step-flat.ts` (per-member `kernel.exportStep`, multiple members merged by renumbering DATA-section entity ids in the text layer; `unit`/`fileMeta` are inert on this channel — ignored, never an error). Everything else (incl. occt) keeps the XCAF assembly channel unchanged.
- `import_step`: `engines: ['occt']` removed; the implementation body was already engine-neutral (`loadBrep` → `kernel.importStep` via `getBrepApi()`). brepkit's adapter implements the L1 methods involved (`importStep`, `fromBREP`, `getSubShapes`, `subShapeHashes` for the E3 roleTable), so no per-engine special-casing was needed.

## Kernel-side fix (brepkit2 repo)

The occt-written fixture `box_boss.step` tripped `unsupported STEP entity: SURFACE_CURVE` inside the brepkit reader. Fixed in `brepkit2/crates/io/src/step/reader.rs` (`build_curve_geometry`): `SURFACE_CURVE` / `SEAM_CURVE` / `INTERSECTION_CURVE` now recurse into their 3D basis curve and ignore pcurves — matching the "ignore unsupported features" directive. Verified locally with a rebuilt wasm (`cargo xtask wasm-build`, smoke test green, fixture imports with volume > 0 via `packages/core/scripts/dbg-brepkit-step-import.ts`). The published npm `brepkit-wasm` (3.6.0) does not yet carry this fix, so the vitest case covering occt-written STEP under brepkit is `it.skip` until the kernel is released and the dependency is bumped.

## Alternatives considered

- **Relaxing the gates to `['occt', 'brepkit']`.** Still a gate — the user explicitly asked for none, and brepkit's kernel really can do the work.
- **Keeping the XCAF writer and faking assembly output under brepkit.** Fabricates hierarchy the kernel does not have; rejected (everything follows the kernel's own implementation).
- **Erroring on non-mm units in the brepkit channel.** Rejected — the directive is "no errors"; `unit` is simply inert there.

## Consequences

- Under brepkit, `cad.exportStep` yields flat, hierarchy-less, nameless/colorless AP203 STEP — by design, not a regression.
- The brepkit channel ignores `unit`; callers needing declared-unit STEP use the occt channel.
- A future brepkit-wasm release unlocks the skipped test (`import-step.test.ts`, brepkit describe block); the verification harness lives at `packages/core/scripts/dbg-brepkit-step-import.ts`.
- Contract texts updated: `docs/ops-api-inventory.md` / `.zh.md` (§3.16, §10.3).
