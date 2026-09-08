# Agent Note: cq-compat workplane stack semantics, transformArg parens, and assembly-consistency STEP compare

Status: implemented

English | [中文](2026-09-08-cq-compat-workplane-stack-step-compare.zh.md)

## Problem

Three root causes, diagnosed in `docs/analysis/2026-09-08-cq-compat-union-compound-bug.md`:

1. **cq-compat feature ops ignored the workplane stack.** `cutBlind`, `cboreHole`, `cskHole`, and boss extrudes operated on the origin only: they never iterated `wp.pts` pushed by `pushPoints`/`faces(...)`, so multi-point feature applications (dual slots, two bosses) produced one feature at the origin instead of one per point. CadQuery semantics (the workplane "stack") require every feature op to take effect at each point on the stack.
2. **`direct-executor.ts` dropped parentheses in nested arithmetic transforms.** `transformArg` emitted `-((((15-8)/2)+(10/2))+0.555)` as `-13.445`, silently collapsing an expression with multiple negative literals and nested parens.
3. **STEP comparisons were not assembly-consistency comparisons.** The old `compareStepFiles` compared only the total solid count of a whole file. The `slide_top` case proved the failure mode: two independent parts (2 leaves) vs one compound (1 leaf) passed the old comparison, although the geometry is different. A STEP cannot be known in advance to be a compound, so every comparison must walk the imported assembly structure (leaf count, names, per-leaf geometry) via `compareAssemblyFiles`.

## Decision

1. **Workplane stack semantics** (`packages/cq-compat/src/workplane.ts`): `resolveFaceSelector` became async and enumerates BREP faces via `getSubShapes(face)` (extremum bbox center; ties broken by larger area; `CenterOfMass` via `getSurfaceCenterOfMass`, `CenterOfBoundBox` via the face bbox center). `extrude`/`cutBlind` loop over `wp.pts`, building a tool per point and fusing with `OVERLAP` 0.1 union; `cboreHole`/`cskHole` capture the points first, then call `hole()` once, then sink the counter/spot per point. Two latent bugs were fixed along the way: the normals table lacked the six `'+Y'/'−Y'/…` alias keys (so `faces('+Y')` fell back to `[0,0,1]` and only cut a thin slice — 12 keys now), and the cbore/csk cylinders used the outward `result.normal` (floating above the material, cutting nothing) instead of `invNormal`.
2. **Parenthesized transform emission** (`packages/core/src/cad-runtime/direct-executor.ts`): `transformArg` emits full parentheses for Unary/Binary/Logical/Conditional nodes; a mesh-mode regression asserts `minX = −10.055 ± 1e-6` (dropping the parens yields `−14.445`).
3. **Assembly-consistency comparison everywhere** (`packages/cq-compat/src/assembly-compare.ts`): `AssemblyCompareOptions.matchNames` (default true) with `leafCount` always enforced equal; `fai_cq_gears` compare scripts switched to `compareAssemblyFiles` (`matchNames: false`); the old `compare-step.ts` is rewritten with a DEPRECATED header pointing to the assembly compare. `writeAssemblyStep` (`cli.ts`) now preserves member names/colors when the primary `brepSolids` lookup misses: it resolves members by index from `compound.children` via `brepOf(child)`.

## Alternatives considered

- **Keep the origin-only feature loop and special-case the mini_lathe scripts.** Rejected: that would paper over a cq-compat semantic hole and contradict the CadQuery stack contract; the user's hard constraint requires pushPoints-then-feature-op to apply per point.
- **Route the STEP comparison through the old solid-count logic plus a volume check.** Rejected: the compound-vs-parts failure is a structural one (leaf topology), not a volume one; only a full assembly walk (leaves, names, per-leaf bbox/volume/COM) catches both the 2-vs-1 case and the 1-product-2-solid case.
- **Make `compareStepFiles` the wrapper around `compareAssemblyFiles`.** Rejected: keeping two entry points invites the old bug to return; the old entry was deprecated and rewired instead.
- **Fix the fai_cq_gears scaffold typecheck as part of this change.** Accepted only mechanically: the scaffold's `RawOcctKernel` was missing the real `getShapeType` declaration and `planarCapAtZ`'s tolerance param inferred the literal `0.01` — pre-existing type-gap failures (present at HEAD) blocking the CI typecheck gate; both were fixed as pure type widening/declaration, no runtime change.

## Consequences

- cq-compat regression expectations calibrated: `cutBlind` dual slots 18400/1 solid, `cboreHole` 18532.41, boss two points 21200/1 solid, `centerOption` (+Y cut 10×30×depth 8) 21680/1 solid — all ±1; cq-compat suite 8/8.
- core suite 1074 passed / 10 skipped (83 files); `cli.test` 13/13 including the new assembly member-name export test.
- `packages/mini_lathe` re-exported from the fixed build: 7 parts (slide_mid is a genuine 2-leaf part — base z∈[−3,8] vs block z∈[11,24.7], no overlap; the legacy snapshot has the same structure), assembly = 6 leaves named `axk/bp/mb/mt/slide_top/tp`. `verify-all.ts` (5 checks: per-part leaf counts, assembly 6-leaf + names, slide_top volume 88282.5/zmax 21.7, new-vs-legacy slide_top and assembly must be DIFFERENT) is all green.
- The legacy `slide_top.step` (pre-fix, 07:44) is one product containing a 2-solid compound (v=90008.3): the assembly compare catches it via geometry (volume/bbox/COM), while the old `gen/slide_top.step` case (2 products) is caught via leaf count — both failure shapes are covered.
- Remaining known issue (pre-existing, out of scope): the assembly's constraints do not actually apply in the CLI export — `assembly.fai.js` never calls `asm.solve()`; calling it triggers a separate CLI bug (`INVALID_SHAPE_ID` in the brep-topology chain). Not addressed here.

## Verification

- `npm run test -w @faicad/cq-compat` 8/8; `npm run test -w @faicad/faijs-core` 1074 passed (incl. the transformArg paren regression).
- CI-equivalent run on Windows (pwsh unavailable — Access denied — so the 9 `scripts/ci.ps1` steps were executed manually): lint, typecheck (root + all workspaces, incl. the scaffold type fixes), build, workspace tests (core 1074 / gear-lib-demo 21 / sheetmetal / faijs-tests, zero stderr), guards (ghost-deps, workspaces-order, madge, api-surface, vendored tsc, layer-boundaries, branding, gen:surface), demo e2e dev 15 + preview 2, doc-sync 12 gates (after adding the `packages/mini_lathe` README bilingual pair), and `npm pack` — all green.
- `packages/mini_lathe/scripts/verify-all.ts` re-runs clean against the re-exported artifacts.
