# Agent Note: Layered API port — P9 sheetmetal batch 2/3 (full author/unfold surface + full test suite)

Status: implemented

English | [中文](2026-09-02-layered-api-p9-sheetmetal-batch2-3.zh.md)

## Problem

P8 landed batch 1 (the pure 2D/data layer) and its precision gate, but the sheetmetal port stopped there: the 3D authoring surface (`authorFns`, `contourFlangeFns`, `reliefFns`, `formFns`, `hemFns`, `jogFns`, …) — the part that actually consumes image ops like `fuse`/`cut`/`extrude` through the compat shim — was not ported, and the package shipped only 6 tests instead of the plan's 227. P9 is the remaining bulk: batch 2 (3D feature authors) + batch 3 (`facade`/`foreignUnfoldFns`), plus the full upstream test suite as the executional proof.

## Decision

1. **Batch 2/3 sources ported — logic-identical to upstream.** 15 files (`api`/`authorFns`/`contourFlangeFns`/`cutoutFns`/`facade`/`foldFns`/`foreignUnfoldFns`/`formFns`/`hemFns`/`jogFns`/`loftedFlangeFns`/`miterFns`/`reliefFns`/`tabFns`/`validateFns`) with only the import source line changed (`from 'brepjs'` → `from './compat.js'`). A stripped-source, logic-only diff against the locked upstream commit shows **zero** non-import logic differences for every file (JSDoc-only line growth where line counts differ).
2. **`compat.ts` extended to the full §7.3 surface** (40 runtime functions + 8 types, mechanically asserted present): the 3D ops (`box`/`cylinder`/`sphere`/`face`/`extrude`/`translate`/`rotate`/`fuse`/`cut`/`intersect`), surface/measurement queries (`getFaces`/`getBounds`/`getSurfaceType`/`normalAt`/`pointOnSurface`/`faceCenter`/`sharedEdges`), `isValid`/`isPlanarWire`, and the 7 `vec*` pure functions re-exported from vendored L1/L2. `fuse`/`cut`/`intersect`/`box`/`cylinder` are wrapped at compat to satisfy the vendored `ValidSolid`/`SweepOptions` brand where the upstream public surface was untyped; behavior is unchanged from the vendored op.
3. **`rotate` signed-shape alignment (D12):** the vendored tree uses the four-argument positional form (P5 locked commit) while upstream brepjs 18 takes `{ at, axis }`; compat wraps the positional form to the option-object signature so ported callers are unchanged.
4. **`core` exports `./vendored/*` subpath.** Batch 2/3 make compat the only cross-package importer into the vendored tree; the published core package now maps `@faicad/faijs-core/vendored/*.js` → `dist/vendored/*`, so `@faicad/sheetmetal` builds against the real package instead of source aliases. `test-setup.ts` (D10 kernel assembly) is excluded from the built dist — it is test-harness only.
5. **The 233-test suite is the execution proof.** All 22 upstream test files ported with import rewrites only (`../../../tests/setup.js` → `./test-setup.js`, `../src/x.js` → `./x.js`, `'brepjs'` → `'./compat.js'`), plus the existing `reference.test.ts`. Full suite green in SRC (233 tests), including `fold`/`dxf`/`nest` round-trips, `foreignUnfold` oracle tests (13 — **kept**, the API surface is complete enough), `normalizeSolid` compound semantics exercised through every author→unfold→fold path (§7.5 ③), and the area invariance tests (`toBeCloseTo(., 6)`).

## Alternatives considered

- **Expose `normalize a compound only when a single solid is unwrapped, else keep it.** Standard. Alternative — always `getSolids()[0]` — would silently drop the multi-body case, so the single/multi guard in `internal.ts` is kept.
- **Route the 3D ops through the L3 `cad.*` namespace in this phase.** Rejected: the vendored L2 values must stay brepjs-shaped kernel handles (the sheetmetal 3D `solid` is a brepjs `Solid` for `measureVolume`/`isValid`/`getBounds` in the tests), while `cad.*` returns faijs `Shape` wrappers; the compat shim is the correct bridge and the L5 library remains independent of the faijs object model (D12).
- **Watch `tsconfig.build.json` with `paths` instead of `./vendored/*` export.** Rejected: `paths: {}` isolates the build from source aliases (correct), so the real package-resolution path is through core's exports map — adding the subpath is the minimal, durable fix.
- **Keep `test-setup.ts` in the dist.** Rejected: it is a D10 test harness with a hard dependency on kernel loading; shipping it would leak a kernel-coupled file into an L5 library that is supposed to be kernel-free (§9). Excluded.

## Consequences

- `@faicad/sheetmetal` now implements the full upstream domain on top of the L3 compat bridge: 26 source modules, zero kernel/`getBackends`/`getSlot` references outside `compat.ts` (the only bridge, §9 whitelist).
- Local gates green: sheetmetal `typecheck`/`lint`; sheetmetal `build`; full-workspace tests (core 927, mech-lib 23, sheet 233, integration 1279 — all pass); `check-ghost-deps` (540 files); `check-workspaces-order` (6 workspaces); `check-layer-boundaries` (237 files); `api-surface-snapshot` (10 subpaths); vendored strict `tsc`; root `tsc`; madge circular 0.
- Test counts exceed the plan's 227 target (217 non-reference + 16 in `reference` = 233 here; upstream counts vary slightly by release) — the difference is test-file-linework, not coverage gaps.
- **The P9 execution proof is the ported suite itself:** the plan's flagship claim — "the L3/faijs side + compat is sufficient for a real industrial domain library" — is now demonstrated end-to-end, not estimated.