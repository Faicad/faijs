# Agent Note: `edgeRef` recovers an unnamed adjacent face by walking the lineage

Status: implemented

English | [中文](2026-09-30-edge-ref-lineage-recovery.zh.md)

## Problem

`cad.edgeRef(of, N)` resolves a numbered edge into an `EdgeTopoRef` carrying the
`(origin, role)` identity of its two adjacent faces. The face path already
recovers a missing identity by walking the lineage; the edge path did not.

`resolveFaceGeometry` handles a `RoleTable` miss by calling `recomputeViaLineage`:
it re-derives the face's hash set along the lineage DAG and writes the answer
back. `edgeRef` had no such step. It called `findOriginRole(table, ordinalToHash,
fo)` — a forward lookup of "which `(origin, role)` owns this face hash" — and on
`undefined` threw `E_TOPO_NOT_FOUND` with `no role lineage`.

A miss is not an authoring error. The part's `RoleTable` is a **cached copy**,
and the entry for a face can be missing from the target part while still being
present and correct at the **root** (the node where the name was born), when an
intermediate op carried a stale hash table forward unchanged. The identity
existed the whole time; only the target's copy lost it. The face path recovered
from exactly this drift; the edge path turned it into a hard failure, so
`cad.fillet` / `cad.chamfer` on such a part died with `no role lineage`.

## Decision

Give the edge path the mirror image of the face path's recovery, and run it only
after the forward lookup fails.

`recoverEdgeFaceRole` (in `packages/core/src/api/topo-resolve.ts`) walks the
lineage in the opposite direction from `recomputeViaLineage`: the face path knows
the `(origin, role)` and hunts for its hashes, while the edge path knows the face
hash and hunts for the `(origin, role)`. It enumerates every `(origin, role)`
pair in every registered node's output table — the root's table is intact by
assumption — and for each candidate advances the root's ordinals down the DAG to
the target part, converts them to that part's current face hashes, and returns
the candidate whose set contains the face hash being recovered.

`edgeRef` calls it only when `findOriginRole` returns `undefined`, and backfills
the recovered `{origin, role}` so the normal resolution continues (exact match or
the geometric fallback, unchanged).

The advance rules are self-contained rather than borrowed from
`resolveViaLineage`'s stricter contract, because the node shapes seen here are
wider:

- an ordinal evolution (`HashEvolution`) is applied as-is;
- an `identity`-provenance node (copy / place / transform) that carries **no**
  evolution advances 1:1 — semantically right, since an identity does not
  reorder faces, and it covers the known gap where the compat path through
  `place.ts` never called `attachEvolution`;
- anything else without an evolution abandons that candidate rather than
  guessing.

A `seen` set guards the walk so a malformed DAG with a cycle aborts instead of
spinning.

## Consequences

- `edgeRef` no longer throws `no role lineage` for a face whose identity is
  present at the lineage root and merely absent from the target part's cache.
- Zero-regression is structural, not incidental: recovery returns `undefined`
  when no candidate matches, and the caller keeps the original error untouched.
  It also only runs on the failure path, so the hot path is unchanged.
- `LineageGraph.stmtIds()` is the only new graph API — a read-only accessor for
  the candidate enumeration. No behavioural change to the graph itself.
- The identity-class-without-evolution case is a **pre-existing gap**, not one
  introduced here: `place.ts` reached through the compat path does not
  `attachEvolution`. The 1:1 rule papers over it for recovery purposes; the
  underlying gap is still open and worth closing at the source.

## Gotcha worth remembering

The test that proves the recovery had a **typecheck failure the tests did not
catch**: `tableOfPart` returns `ReadonlyMap<string, …>` while `RoleTable` is
`ReadonlyMap<StmtId, …>`, and `StmtId` is a branded type. Vitest ran green
(strips types) while `tsc --noEmit` rejected the new test file at three call
sites. A green vitest run is not evidence that an integration test typechecks.

## Files

- `packages/core/src/api/topo-resolve.ts` — `recoverEdgeFaceRole` and its
  `lineageHashesAt` walk (candidate enumeration, ordinal advance rules, cycle
  guard).
- `packages/core/src/api/edge-ref.ts` — the recovery call, gated on
  `findOriginRole` returning `undefined`, with the backfill.
- `packages/core/src/topology/naming/lineage.ts` — `stmtIds()`.
- `packages/tests/faijs/edge-ref/edge-ref-lineage-recovery.test.ts` — a
  `box → place` chain whose `placed` role entry is deleted to reproduce the
  drift; asserts the unit-level recovery returns the true identity, that
  `edgeRef` resolves end-to-end, and a control case where the root is corrupt
  too and the original error must still be raised.

## Alternatives considered

- **Reuse `recomputeViaLineage` by first guessing the `(origin, role)`.**
  Rejected: that function answers the opposite question (identity → hashes), so
  calling it requires already knowing the answer.
- **Rebuild the target part's whole `RoleTable` on a miss.** Rejected: it is a
  much larger mutation of runtime state on an error path, for a case that a
  read-only walk plus a local backfill already covers.
- **Treat `no role lineage` as a hard authoring error and leave it.** Rejected:
  the same drift is already recoverable on the face path, so leaving the edge
  path strict makes `edgeRef` fail on models that `resolveFaceGeometry` accepts.
