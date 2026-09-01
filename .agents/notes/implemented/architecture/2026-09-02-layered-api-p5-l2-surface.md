# Agent Note: Layered API port — P5 L2 full-surface (operations/2d/sketching/io/gear + text)

Status: implemented

English | [中文](2026-09-02-layered-api-p5-l2-surface.zh.md)

## Problem

P4 landed the first L3 end-to-end path, but the L2 surface was still partial: only `topology/` + `query/` + `measurement/` (the P3 first batch) lived in the vendored tree, so the plan's **P5 gate — L2 full surface (`operations/` `2d/` `sketching/` `io/` `gear/`, excluding `csg`) — could not be exercised with brepjs's own tests.** P3 deferred the `2d/blueprints` / sketching layers ("corner/blueprint/sketch 层属 2d/blueprints，留 P5"), so the P5 harness had to bring the whole second-batch API into the vendored tree and prove it green.

## Decision

1. **Port the full second-layer surface verbatim from brepjs main (b7a3705)**: `operations/` (24 files: assembly/convexHull/dh/exporterFns/exporters/guidedSweep/history/ik/instance/joint/mate/multiSweep/pattern/roofFns/straightSkeleton/thread/urdf…), `2d/` (38 files — lib/, blueprints/ incl. boolean2D/booleanOps/compoundBlueprint/svg/baseSketcher2d/blueprintSketcher), `sketching/` (11 files), `io/` (12 files), `gear/` (4 files) plus `kernel/solverAdapter.ts`. Only the `@/` root alias is rewritten to a relative prefix; everything else is byte-for-byte from upstream.
2. **Keep D6 exclusion and defer what the plan defers**: `csg/` stays out (D6); `implicit/` is not brought in — its only module (`sdfFns.ts`) depends on the plan-deferred `voxel/`. `text/` + `projection/` + `draw3d`/`drawingFactories` are included as dependency closure of sketching (the plan lists text+projection in P5), together with the tiny `kernel/occt/wasmTypes/externals.ts` type shim (opentype.js `OpenTypeFont` interface — a pure type file, not OCCT logic).
3. **Test harness mirrors P3**: `packages/tests/faijs/p5-vendored-surface/` — `p5-surface.ts` facade re-exports the P5 public API surface from the vendored tree; `kernel-setup.ts` wires the D10 single-instance kernel (`initOcctWasm()` + `bindOcctKernel()`, with the setup.ts contract names `initKernel`/`initOC`/`initOCCT`/`currentKernel` plus the top-level `getKernel` reader); the divergence registry is shared with the P3 harness (relative import to `p3-vendored-surface/kernel-divergences.js`). brepjs's own test files are copied under `tests/`, imports rewritten `@/…/` → vendored path or facade; the only test-side adaptation is the font-search candidate list in `textBlueprints.test.ts` (upstream lists only Linux system-font paths; the harness adds `C:\Windows\Fonts`, so the suite runs on win32).
4. **Acceptance = brepjs's own tests, run in the full-repo vitest**: 29 files / 631 tests across `gear` (geometry/math/solids), `operations` (loft/pattern/extrude/revolve/sweep/convexHull/straight) plus assembly/DH/joint/instance/urdf, `2d` (definitions/offsets/boolean2D/blueprints/svg), `sketching` (fns/drawing factories/compound/draw3d), geometry (curves/approximations/curve2dFns/svg2D), and `text` (textBlueprints using real TTF metrics — 16/16, no skips) — all green with the whole-suite baseline (core 880/9, stdlib 46, tests 1269, doc-sync 12 gates).

## Alternatives considered

- **Ship `implicit/` together with a synthetic `voxel` adapter** (a JS→Rust-WASM bridge shim). Rejected: `voxel` is plan-deferred behind unavoidable WASM; a fake adapter would hide the real dependency and make the divergence registry lie.
- **Write dedicated faijs tests instead of copying brepjs's tests**. The project convention since P3/P4 is to run brepjs's own suite verbatim against the vendored tree — it is the accepted gate and it also catches export-surface drift (it immediately did: the harness facade's export list has to mirror the P5-visible names exactly).
- **Kill the facade and re-export the root `index.ts` barrel** in the harness. Rejected: the root barrel pulls in `csg/`, `mesh/`, `voxel/` etc., which P5 excludes by decision — a facade that lists the P5-visible names is the deliberate contract.
- **Wait for a TypeScript-level reimplementation of the L2 layer**. Rejected: verbatim port + green own-tests + boundary/ghost/typecheck guards is the whole port strategy.

## Consequences

- The L2 full surface now runs on faijs's own host-bound kernel and passes brepjs's own tests — a 237-file vendored tree with every boundary/ghost-dependency/isolated-compilation check green.
- The `p5-surface` facade is the maintainable "P5 public surface" map: any P6 change that widens what L3 re-exports will surface as a missing facade entry before anything else.
- The font-candidate fallback is the only test-side diff from upstream's test file; the harness is the right home for such cross-platform adaptations (never the vendored source).
- Next gates: P6 (L3 full + kill stdlib, plus the D12 compatibility shim) now has the whole L2 layer beneath it, and the 3d-wave()/roller/… P6 sample set can be added directly on this surface.