# Agent Note: STEP base role table on the editor load path

Status: implemented

English | [中文](2026-10-15-step-base-role-table-editor-path.zh.md)

## Problem

The STEP parametric-edit base layer (plan 2026-09-18) built the imported-part
role table (`imported:<i>`) only on the platform ops `cad.import_step` /
`cad.import_brep`. The editor consumes `cad.load`, which:

1. passed no `roleTable` at its `fromBrep` call sites, and
2. is a bare async function (not wrapped by `defineOp`), so even a passed table
   would never be promoted to the part-keyed table (`outputTablesByPart`) that
   `tableOfPart` / the executor's `setRoleTableHook` / `buildNamingInput` read.

Consequence chain (review 2026-10-15): `cad.load` STEP parts got `faces === null`
on every edge naming row → `hasUsableEdgeNaming === false` → chamfer / fillet were
disabled for imported STEP parts. Additionally, for multi-solid files the
compound members all share one StmtId, so plain `imported:<i>` roles collide
between members (geometrically identical members produce identical face hashes).

## Decision

- **`extra/ops/load.ts` builds the role table on the BREP path** (isomorphic with
  `import-step.ts:74-80`):
  - single part: `imported:<i>` (identical to `import_step`);
  - multi-part compound: `imported:<memberIdx>:<i>` per member — the merged table
    (one StmtId origin) keeps every member's role keys unique.
- **Part-keyed registration is done manually.** Because `load` is a bare async
  function, the part-keyed table is recorded explicitly via
  `runtimeLineage.recordOutput(stmtId, table, solid, part)` after the shape is
  built (single part) or the compound is assembled (multi part) — the same
  promotion `define-op.ts` performs for defined ops (import-step.ts GOTCHA note).
- **`runtime.ts buildNamingInput` learns compound terminals.** A compound has no
  single `solidCache` entry, so `ordinalToHash` was never computed → even with a
  table the merged naming stayed null. The compound branch now concatenates per-
  child `subShapeHashes` in children declaration order, aligned with
  `buildCompoundTopologyRuntime`'s merged face rows.

## Alternatives considered

- Route the editor through `import_step`: rejected — the editor path is
  `cad.load` by design; platform ops are not consumed by 3d_editor.
- Assign per-member synthetic StmtIds: rejected — origins must be real statement
  ids for lineage resolution; faking ids breaks statement↔anchor consistency.
- Keep `imported:<i>` for all members: rejected — identical members collide in
  `roleOfOrdinal` (first-match wins), exactly the P0-2 red line.

## Engineering notes

- The part-keyed record is the load-bearing half: disabling only the `fromBrep`
  slot table (keeping `recordOutput(..., part)`) still passes the editor-path
  assertions; disabling the record itself reproduces the pre-fix failure
  (`expected -1 to be greater than or equal to 0` — no edge row with `faces`).
- `loadCache` (content-hash) caches only the parsed parts; the `fromBrep` +
  roleTable work runs on every execute, so cache hit and miss both produce
  naming.

## Consequences

- Imported STEP parts are editable again: `edgeNaming[i].faces !== null` on the
  editor path, chamfer on a base edge succeeds and replays after parameter
  changes, multi-member roles stay unique per member.
- Host side still needs to store the derived naming on its load path
  (`_commitLoadSideEffects`), otherwise `hasUsableNamingForFile` cannot see the
  naming right after import (tracked in the 3d_editor change of the same PR).

## Testing

- New `packages/core/test/api/load-step-parametric-edit.test.ts`: editor-path
  assertions on real STEP fixtures (`box_boss.step`, `test-model.step`) — P1
  (usable edge naming), P2 (loadCache hit + miss), P3 (chamfer on base edge +
  replay), P4 (per-member role uniqueness in merged naming).
- Full `packages/core` suite: 349 files, 3927 passed / 13 skipped. Full monorepo
  suite: 440 files, 4837 passed / 18 skipped. typecheck + lint green.
