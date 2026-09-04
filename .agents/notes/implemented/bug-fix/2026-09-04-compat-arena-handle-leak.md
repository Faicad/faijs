# Agent Note: compat arena handle leak — release getSubShapes query handles

Status: implemented

English | [中文](2026-09-04-compat-arena-handle-leak.zh.md)

## Problem

`@faicad/faijs-tests` compat e2e ⑦ (sheetmetal-flow / mech-lib-flow) asserted that repeated identical `execute()` calls keep the occt-kernel live arena bounded; the measured `shapeCount` grew +2484 over a small batch (≈ +621/exec), and a bare `cad.box({ size: 20 })` in a fresh auto-mode runtime grew linearly +54…+69 per re-execute. `shapeCount` counts live kernel shapes, not created shapes (occt-wasm `getShapeCount`), so the growth was a real handle leak, not a counting artifact. The leak predated the repro workspace (present at HEAD e882b77 and unreproducible even from a probe replaying on a clean engine tree), so it was engine-owned, not introduced by any working-state change.

## Decision

The leak is `kernel.getSubShapes()`/`subShapeHashes()` query handles: `getSubShapes` allocates each sub-shape as an independent arena slot, and the engine's callers read geometry/queries from those slots but never released them. The fix releases every such query result that is used only for temporary lookup, at the exact place where it is created:

- `occt-kernel/topologyExt.ts` — `buildSelectorManifest`: every `getSubShapes` face/edge/solid/shell vector (top-level, per-face, per-shape-entry) is registered in a `transient` list and batch-released in a `finally` around the build core. The manifest output carries only plain data (polylines, hashes, ordinals), so no released handle escapes.
- `topology/naming/roles.ts` — `assignRoles`: the `getSubShapes(shape, 'face')` handles are read (via `captureFaceHint`) and then released in a `finally`; role keys are hash/ordinal based, so no dangling handle leaves.
- `occt-kernel/meshReconstruct.ts` — `reconstructSolidFromMesh`: the face vector from `getSubShapes(imported, 'face')` was never released after the sewing loop; it (and the non-returned `fixShape` intermediate solid) are now released on every exit path.

The ownership rule stated explicitly: if a `getSubShapes` result is used only for geometric queries (center/normal/surfaceType/hash/ordinal/`isSame` matching) and never handed to a caller as a live handle, the caller function must release it before returning. Query results that are deliberately exported to a consumer (see `api/topo-resolve.ts` building a `ResolutionContext` whose `faces`/`edges` carry live handles for `resolveFaceGeometry` / `chamfer`) keep their handles — releasing them inside the builder would hand out dangling handles.

## Alternatives considered

- **Move the release into occt-wasm / the kernel wrapper.** Rejected: the wasm is vendored and the wrapper is a shared low-level surface; the leak is a caller-contract problem, best enforced at the callers that allocate the sub-shape vectors.
- **Fix `topo-resolve.ts` / `chamfer.ts` the same way.** Rejected in this change: those functions export live handles into a consumer-owned `ResolutionContext` (consumers query `isSame`, pass the handle to `chamferDistAngle`, etc.); releasing inside the builder would break the caller. There is a separate, lower-severity chase there (a caller-side disposal of the context's handles) that is out of scope of the reported leak and its repro.
- **Silence the failing assertion / relax the bound.** Rejected: the bound proved a real leak; the value of the assertion is that it catches an unbounded arena.
- **Keep the probe scripts in the tree.** Rejected: they were throwaway diagnostics; the attribution now lives in this note and the regression test.

## Consequences

- `topologyExt.ts`, `roles.ts`, and `meshReconstruct.ts` now return the temporary sub-shape slots they allocate; repeated identical execution no longer grows the live arena.
- Regression gate: `packages/core/src/cad-runtime/arena-bounded.test.ts` re-runs the bare `cad.box` ×10 and asserts the live `shapeCount` stays ≤ 100 above the post-warm baseline (pre-fix it was +54/exec − ≈ +540 over 10, deterministically above the bound). The pre-existing e2e ⑦ assertions in `sheetmetal-flow`/`mech-lib-flow` (≤ 200 / ≤ 400) and the compat-op ④ arena comparametric check are now green.
- Staled slower flows (mesh→STEP reconstruction) no longer leak a face vector per rebuild.
- Known remaining: chamfer's `ResolutionContext` live-handle disposal on the BREP edge path is a separate consumer-owned ownership question, tracked as such and not addressed here.

## Verification

- `packages/core`: `cad-runtime` + `api` suites (269 tests) and `occt-kernel`, `brep-topology`, `brep/export/step-export`, `topology/naming` all pass; the new `arena-bounded.test.ts` is green.
- `packages/tests`: `compat-e2e` (sheetmetal-flow + mech-lib-flow with ⑦ arena assertions, aluminum-enclosure, lib-error, shape-borrow) and `compat-op` total 34 pass; ⑦ no longer trips.
- mech-lib `b7-no-face-evolution` (also feeds `buildAssemblySelectorManifest`) passes.
- Target measurement: repeated `cad.box` execute live-arena delta is now flat (0 extra slots per repetition for the second+ runs).