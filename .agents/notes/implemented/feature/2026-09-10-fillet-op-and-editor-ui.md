# Agent Note: BREP-only fillet op (equal-radius) + 3d_editor UI

Status: implemented

English | [中文](2026-09-10-fillet-op-and-editor-ui.zh.md)

## Problem

The `cad.*` op set had no fillet. A part needing a rounded edge could not be expressed in `.fai.js`, and the 3d_editor host had no fillet tool. Like chamfer, fillet is a BREP-only operation, but unlike chamfer it uses the `*WithHistory` OCCT API to obtain face evolution data for roleTable propagation -- ensuring that subsequent feature operations can still select faces/edges by role after the fillet modifies the topology. The chamfer `equal` path was also upgraded to use `chamferWithHistory` for the same roleTable propagation benefit.

## Decision

### faijs engine (`packages/core`)

- `cad.fillet(part, { edges, radius })` is declared as a BREP-only op via `defineOp({ capabilities: ['directEdit'], brep })` in `api/fillet.ts`, registered into the `cad` namespace (`api-namespace.ts`), exported from `api/index.ts`, and listed in `api/surface/arg-spec.ts` with `scriptFace: false` (the hand-written dual-op shadows the vendored projection).
- The op calls `filletWithRoleTable` (`brep/face-evolution.ts`), which wraps `kernel.filletWithHistory(solid, edges, radius, inputHashes, bound)` and decodes the returned `BrepEvolutionData` into:
  - an ordinal-keyed `FaceEvolution` (for UI selection / visualization),
  - a hash-keyed `HashEvolution` (for role propagation),
  - a propagated `roleTable` (via `propagateAllOriginsLocal`, structurally equivalent to `naming/roles.propagateRoles` but placed locally to avoid a circular dependency between `brep/` and `topology/naming/`).
- The `directEditWithRoleTable` function in `face-evolution.ts` is the shared single-input WithHistory wrapper for both fillet and chamfer; `filletWithRoleTable` and `chamferWithRoleTable` are convenience aliases.
- `chamfer.ts` `equal` path was upgraded from `kernel.chamfer` (no history) to `chamferWithRoleTable`, so chamfered solids also propagate role tables.
- BREP engine interface (`brep/engine/primitives.ts`) gained `fillet`, `filletVariable`, `filletWithHistory`, `chamferWithHistory` declarations; the mock in 4 topology/naming test files was updated to include these.
- Error handling: `assertFilletParams` validates `edges` (non-empty array of well-formed `EdgeTopoRef` with `kind:"edge"` and two-entry `faces`) and `radius` (positive finite number); OCCT failures are translated to `E_FILLET_RADIUS_TOO_LARGE` -- never silently returning the un-filletted shape.

### 3d_editor host

- `stores/tools/fillet-store.ts`: Zustand store managing tool activation, radius, edge refs, panel position, undo (Tier A fields registered, debounced snapshot for radius input).
- `engine/features/fillet.ts`: Feature descriptor with `buildFilletCode` (code generation), `filletBackfill` (timeline edit restore), `filletCollectArgs` (current state to args).
- `engine/components/fillet/FilletToolbar.tsx`: Toolbar button with BREP-only gating (muted when no BREP target in scene).
- `engine/components/fillet/FilletPanel.tsx`: Draggable panel with radius input, edge selection status, error display, and execute button.
- `engine/components/fillet/FilletPreview.tsx`: Real-time BREP preview via `ScriptEngine.filletPreview` with debounced rebuild on radius/edge changes.
- `engine/script-engine/ScriptEngine.ts`: `filletPreview` method -- executes fillet without committing geometry, returns mesh for preview binding.
- `engine/version-store/Command.ts`: `fillet` added to `COMMAND_TYPES`.
- `locales/{zh,en}.json`: 19 i18n keys for the fillet UI.
- `engine/script-engine/feature-icon-map.tsx`: fillet icon and color mapping.

## Alternatives considered

- **Declare a mesh fillet too.** Rejected: fillet is geometrically a BREP-only operation; a mesh fallback would be a fake approximation. The dispatcher correctly reports `E_MESH_UNSUPPORTED` for mesh-only inputs.
- **Use `kernel.fillet` without WithHistory.** Rejected: without face evolution data, roleTable propagation is impossible -- subsequent feature operations cannot select faces/edges by role after a fillet. The `WithHistory` API returns `BrepEvolutionData` at zero extra kernel calls beyond the fillet itself.
- **Place `directEditWithRoleTable` in `topology/naming/`.** Rejected: it would create a circular dependency between `brep/` (which needs to call it) and `topology/naming/` (which owns `propagateRoles`). The function is placed in `brep/face-evolution.ts` with a locally implemented `propagateOriginRoles` that is structurally equivalent.
- **Support variable radius in M1.** Rejected: M1 scope is equal-radius only; variable radius (`filletVariable`) is planned for M2 with single-edge + no-roleTable degradation.

## Consequences

- `fillet` is now a real op surface: the `cad` namespace carries 31 functions (was 30); `ops-api-inventory.md` and `api-contract.md` are updated.
- The `chamfer` `equal` path now also propagates role tables, fixing a latent issue where post-chamfer feature operations could lose role-based selection.
- 4 topology/naming test mocks were updated to include the new `BrepEngineApi` methods (`fillet`, `filletVariable`, `filletWithHistory`, `chamferWithHistory`).
- 3d_editor lint was fixed: 3 files (`Command.ts`, `features/types.ts`, `stores/core/tool-store.ts`) had accumulated multiple UTF-8 BOM markers at the file head, causing `no-irregular-whitespace` errors.

## Verification

- `fillet.test.ts` (10 tests): parameter validation -- valid params pass; empty/missing edges throw `E_FILLET_NO_EDGES`; bad edge refs throw `E_FILLET_BAD_EDGE_REF`; bad radius throws `E_FILLET_BAD_RADIUS`.
- `chamfer-math.test.ts` (6 tests): unchanged, all pass.
- `face-evolution.test.ts` (12 tests): unchanged, all pass.
- 4 topology/naming test files: all pass after mock update.
- Typecheck: `tsc --noEmit` passes clean.
- Lint: `eslint` passes clean for all fillet-related files.
- 3d_editor lint: all fillet-related files pass; BOM-fixed files pass.
