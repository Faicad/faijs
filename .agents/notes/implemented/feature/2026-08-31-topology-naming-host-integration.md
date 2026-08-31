# Agent Note: Host-side TopoRef integration (M5) — capture glue, naming cache, and op refs

Status: implemented

English | [中文](2026-08-31-topology-naming-host-integration.zh.md)

## Problem

The faijs engine emits `ExecutionResult.naming` (per-part naming rows) as of the TopoRef work, but the 3d_editor host had no way to consume it. Assembly persisted `faceId` and drill persisted `faceNormal` into `.faijs` scripts — both are snapshot/ordinal-based refs that cannot survive upstream parameter edits, and `faceId` in particular stopped being readable by the engine at all. The host needed a glue module that maps a picked face row to a `FaceTopoRef` at click/commit time, a place inside ScriptEngine that caches the naming map at exactly the point where the topology result is already consumed, and feature codegen that writes a TopoRef literal instead of the legacy ordinal/snapshot fields.

## Decision

The host consumes the naming surface from `@faicad/faijs/browser` (`captureTopoRef`, `FaceTopoRef`, `EdgeTopoRef`, `PartNaming`) as A/B/C contract members; the symbol list was updated in the host contract test.

- A new `capture-topo-ref.ts` glue (lives in `src/engine/topology/`, not `src/lib/` — the lib layer is forbidden from importing stores/engine) maps `scopedId + faceRowIndex` → naming row → `FaceTopoRef`. It reads the terminal part name by reverse-mapping through `terminalToScopedId`, pulls the row from the engine's last `ExecutionResult.naming` cache, and catches `TopoRefError`. If there is no row (no naming context), it returns `null` and callers fall back to the legacy geometry snapshot — never a silent ordinal pick. A `setTestOverrideNaming` injection supports unit tests.
- ScriptEngine caches the naming map (`getLastExecutionNaming`) at exactly the sites that already consume `result.topology` (`commitSceneResult`, `_appendExecute`), satisfying same-time caching of naming and topology.
- For mesh-mode primitives (which have no BREP solid and thus no per-terminal `buildBrepTopology` in `collectResult`), the host now calls `runtime.setTopology(partName, 'primitive', buildSelectorRuntimeData(...))` right where the primitive is created and where its topology is rebuilt, so that `SelectorRuntime.faces`-driven `faceHints()` populate and exec-time `faceNaming` rows resolve at click time.
- Assembly `confirmAssemble` builds `FaceConstraint.fixedFace/movingFace` as `{ topoRef: FaceTopoRef }` when capture succeeds, else the legacy `{ surfaceType, center, normal }` snapshot; the persisted `faceId` field is removed and never written to scripts. The preview solver is unchanged (it still solves from geometric data).
- Drill: the click handler captures `clickFace = faceTopoRefFromRow(targetScopedId, faceRowIndex)` from the picked face (triangle → `faceIds` → face row), stores it in `drill-store.clickFace`, and the drill feature codegen writes `face: FaceTopoRef` when present. Because a drill axis is a per-point direction, the codegen ALSO keeps `faceNormal` (the exact ray-cast click normal) and the engine treats that snapshot as the authoritative axis, using the `face` ref as the persisted identity reference and as fallback when no `faceNormal` is present. Rationale: a curved face (e.g. a cylinder side) has no single normal that can reproduce the click-point direction — the engine has no point-to-surface projection API, and a `cylinder:lateral` row's hint normal is just the axis — so a face-only ref cannot recover the radial drill axis the user picked. `position` stays; backfill reads `faceNormal` first, then the face hint.
- `packages/stdlib/src/topo-resolve.ts` exposes the same `resolveFaceGeometry` normal used by the history path, so a script that has only `face` (planar faces, hand-written) still derives its normal at execution.

## Alternatives considered

- **Put the capture glue in `src/lib/topology/`.** Rejected: eslint's layer-boundary rule bans `lib → stores/engine` imports; the glue needs both `ScriptEngine.naming` and `script-store`, so it moved to `src/engine/topology/`.
- **Persist engine-computed geometry snapshots forever.** Rejected: the whole point of §6.2 is that assembly/drill refs survive parameter edits across replay; snapshots do not; and the engine already derives the face geometry from a `FaceTopoRef` at execution.
- **Always write `face` even without naming data.** Rejected: mesh parts loaded without a topology run must keep working; the legacy `faceNormal` snapshot is the honest fallback for "no naming context".
- **Read naming from `topology-store`/a fourth map bucket.** Rejected: the existing per-source runtime maps stay unchanged; naming lives with the ScriptEngine result cache at the same lifecycle as `result.topology`.

## Consequences

- `faceId` is removed from the persisted face-ref write path in assemble-store and drill feature; engine keeps parsing legacy scripts that still contain `faceId`/`faceNormal` keys.
- Mesh-mode primitive drill/assembly refs resolve via `setTopology`-fed `faceHints`, so exec-time normal derivation works for mesh parts as well, outside BREP.
- `clickFace` is runtime-derived and not part of the undo/naming serialization surface.
- Host build, typecheck, lint, unit suite, and jsdom component suite are green; contract-entry whitelist updated with the naming-surface symbols.

## Verification

Tests added: unit tests for `faceTopoRefFromRow`/`edgeTopoRefFromRow` (complete ref, mesh hint-only row, no row, out of range, unknown scopedId), an assembly `confirmAssemble` test asserting a `FaceTopoRef` is written when naming data is supplied and that `faceId`/center/normal snapshot form otherwise, and drill `recordFeature` tests asserting `face` + `faceNormal` are both written when `clickFace` is present and `faceNormal` alone when not. Engine regression: a `topology-naming` integration test verifies that a drill given both `face` and `faceNormal` executes on the BREP chain without error. Full node suite (1877) + jsdom suite (348) + topology/assembly e2e green.