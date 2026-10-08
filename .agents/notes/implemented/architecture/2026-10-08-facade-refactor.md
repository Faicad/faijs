# Facade Refactor: createRuntime Unification and Subpath Enumeration

**Date:** 2026-10-08
**Status:** implemented
**Class:** architecture
**Plan:** `docs/plans/2026-10-08-facade-refactor-plan.md`

## Decision

Unified the two same-name `createRuntime` functions into a single implementation, collapsed the umbrella facade (`index.ts`) from 252 lines of hand-listed re-exports to `export *` from sub-module index files, replaced wildcard subpath exports with explicit enumeration, and added a guard script (`check-facade.mjs`) to prevent drift.

## What changed

### Phase 1: createRuntime unification

- **Deleted** `cad-runtime/createRuntimeWithCad.ts` — its cad-auto-registration logic moved into `createRuntime` in `cad-runtime/runtime.ts`.
- **`createRuntime`** now has a single signature `(ports, mode?, libs?, options?)` and auto-registers the built-in `cad` namespace when `libs.cad` is not provided.
- **`createBareRuntime`** added as the named factory for the pure-engine variant (no cad auto-registration).
- All umbrella entries (`index.ts`, `browser.ts`, `weapp.ts`) now re-export from `cad-runtime/runtime` instead of `createRuntimeWithCad`.
- `execute-script.ts` updated to import from `cad-runtime/runtime`.
- `tessellation-density.test.ts` updated: 3-arg `(ports, 'brep', { tessellation })` → 4-arg `(ports, 'brep', undefined, { tessellation })`.

### Phase 2: Facade collapse

- **New index files:** `boolean/index.ts`, `primitives/index.ts`, `sdf/index.ts` — aggregate public API surface for their submodules.
- **Updated `mesh/index.ts`** — expanded to cover all public exports previously hand-listed in `index.ts`/`browser.ts`; removed brep re-exports (brep has its own index).
- **`index.ts`** collapsed from 252 lines to ~130 lines using `export *` from `./mesh`, `./brep`, `./boolean`, `./primitives`, `./sdf`.
- `browser.ts` kept hand-written (B/C/D classification is meaningful documentation; aliases like `runSdfMain` / `PreviewSdfMesh` require explicit re-export).

### Phase 3: Subpath explicit enumeration

- **`package.json` exports:** 11 wildcard patterns (`./mesh/*`, `./brep/*`, `./io/*`, etc.) replaced with explicit path entries.
- Only `./api/*` wildcard retained (api/ modules grow frequently; explicitly permitted).
- Enumeration based on actual consumption in 4 downstream repos (3d_editor, faijs-cadquery, faijs-freecad, faijs-openscad) + internal monorepo consumption.

### Phase 4+5: Guard script

- **`scripts/check-facade.mjs`** — three checks:
  1. Facade files (`index.ts`, `browser.ts`, `weapp.ts`) must only re-export (no `export function`/`export class`/`export const`).
  2. `package.json` exports must not add new wildcards (only `./api/*` permitted).
  3. Only one file may define `export function createRuntime` (signature divergence detection).
- Added to both `ci.ps1` and `ci.sh`.

## What was NOT done

- `browser.ts` not collapsed to `export *` (aliases + B/C/D classification make it impractical without losing documentation value).
- 13 `api/*/index.ts` directory facades not audited (listed as follow-up in the plan).
- 3d_editor weapp worker 3-arg call site not modified (external repo; plan §4.1).
- Optional optimizations (3d_editor cad override → one-step, faijs-freecad `new CadRuntime` → `createRuntime`) deferred.
