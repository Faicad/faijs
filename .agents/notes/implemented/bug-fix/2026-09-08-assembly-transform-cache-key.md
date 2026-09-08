# Agent Note: assembly transform application syncs solidCache by variable name, not memberNames

Status: implemented

English | [中文](2026-09-08-assembly-transform-cache-key.zh.md)

## Problem

After `do_assemble()`/`solve()` on an assembly whose `memberNames` differ from the statement variable names (the cq-compat path: CadQuery short names like `axk` vs script variables like `shape_axk`), the CLI export failed with occt-wasm `INVALID_SHAPE_ID` at `buildSolidTopologyRuntime` (brep-topology.ts:99). Root cause:

- `applyPendingAssemblyTransforms` (direct-executor.ts:450) released the old BREP handle (`kernel.release(solid)`) and then synced the new solid into `solidCache` under the **memberName** key (`setSolidHook(asPartName(name))`), while `solidCache` is keyed by **statement variable names** (the `setSolid` hook at runtime.ts:404 + `buildBrepTopology` lookups by `shape_axk`).
- The update therefore wrote to a key that does not exist; the variable-name key kept pointing at the released dangling handle, and the export-time topology build called `meshShape` on it → `INVALID_SHAPE_ID`. `changedSet` had the same key mismatch (`changed.add(memberName)` while hosts refresh by variable name).
- `memberNames` must keep the short names (CadQuery's constraint DSL references members by them; the solver maps constraint `part` → member index through them). The bug is only that the *cache key* reused them.
- Verified by minimal repro: A (no `memberNames` → engine falls back to variable names) exports fine; B (explicit `memberNames: ['x','y']` with variables `a`/`b`) fails with `INVALID_SHAPE_ID`. The 3d_editor path never hit this because it does not pass `memberNames` (variables names are the member names).

## Decision

In `applyPendingAssemblyTransforms` (packages/core/src/cad-runtime/direct-executor.ts), resolve each member's **variable name** via `nameOf(member)` (the shapeToName table that the executor fills with `setName` after each statement) and:

- sync `solidCache` under `varName ?? memberName` (variable name wins — it is the cache key);
- record `changedSet` under the variable name, and additionally under the member name when the two differ (hosts that consume poses by member name — P3 kinematics — keep working; the kinematics map itself is unchanged and still keyed by member names).

Mesh in-place baking, BREP rigid transform, `ensureSlot(member).solid = transformed`, and the kinematics propagation (P3, member-name keyed) are untouched. `ModuleExecutor` is gone (P6), so direct-executor is the only application site; `setSolidHook` is called with variable-name keys everywhere else (per-unit sync at :357/:373), which this change now matches.

## Alternatives considered

- **Fix in cq-compat by passing variable names as `memberNames`.** Rejected: the CadQuery constraint DSL and `buildAssembly` semantics require the short names; changing the compat layer would break constraint→member resolution and diverge from CadQuery.
- **Rewrite `solidCache` to be keyed by member names.** Rejected: solidCache is consumed by topology/naming/export paths keyed by statement variable names (and by the 3d_editor statement-cache); retargeting it would ripple across the runtime.
- **Keep the memberName fallback only when `nameOf` misses.** Accepted: `varName ?? name` is a pure fallback for shapes without a registered variable name (assembly members are always statement outputs, so `nameOf` should hit; the fallback preserves the old behavior if it ever misses).

## Consequences

- Minimal repro B (explicit short `memberNames` + `do_assemble`) now exports successfully; the mini_lathe `assembly.fai.js` + `asm.solve()` repro (11383 STEP ents) exports successfully — both previously failed with `INVALID_SHAPE_ID`.
- `cli.test.ts` gained a regression test: explicit short `memberNames` + `do_assemble` → `ok=true`, STEP export, member leaf names still `['left','right']` (member-name preservation untouched).
- Regression: core suite 1075 passed / 10 skipped (83 files, +1 new test); cq-compat 8/8; `packages/mini_lathe/scripts/verify-all.ts` all 5 checks green (6-leaf assembly, names, slide_top baseline, new-vs-legacy DIFFERENT); typecheck (root + all workspaces) and lint clean.
- The previously-diagnosed "constraints not applied in CLI export" is now *resolved*: calling `asm.solve()` applies the solved poses and exports correctly. The remaining diagnostic note in the previous Agent Note is superseded by this fix.

## Verification

- `npx vitest run src/node-host/cli.test.ts` 14/14 (incl. the new short-name assembly regression).
- `npx vitest run` in packages/core (1075 passed / 10 skipped) and packages/cq-compat (8/8).
- `npx tsx packages/core/scripts/faijs-cli.ts run <_asm-short.fai.js> --out x.step --mode brep` and the `_solve-repro.fai.js` (mini_lathe + solve) both succeed.
- `npx tsx scripts/verify-all.ts` (packages/mini_lathe) all green; `npm run typecheck` (root + workspaces) and `npm run lint` clean.
