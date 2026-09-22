# Agent Note — topological face identity is the causal coordinate (StmtId, RoleName)

Date: 2026-09-22
Status: implemented
Area: architecture / topology naming / cross-history identity

## Problem

A face reference written into a `.fai.js` must still resolve to the *same* face
after the model is edited and re-run (e.g. change a fillet radius, then re-pick
the same filleted face). The previous mechanism expressed identity as a
**memory-pointer hash** of the BREP face (`face-evolution.ts`): the hash was a
snapshot of the live OCCT handle, so the whole replay chain paid interest on it.

Concrete failures this caused:

- Importing the same asset twice shared one `origin` (the asset name), so the
  k-th face of two *different* entities computed to the *same* `TopoRef`.
- Renaming a part variable, or any change that rebuilt the shape, changed the
  handle and broke every stored reference — references were not stable across
  replay, which is exactly what they must be.
- The hash was a live-pointer snapshot, so it could never be serialized or
  compared across sessions.

## Decision

Face identity is the **causal coordinate `(StmtId, RoleName)`**:

- `origin` = the `StmtId` of the statement that *produced* the face
  (`String(getCurrentStmt()?.id)`). The producing statement is the chain root,
  even for primitives. Two imports of one asset are two statements, hence two
  distinct origins.
- `role` = a structured `RoleName` (seven closed kinds: `semantic` / `wall` /
  `hole` / `replica` / `splinter` / `generated` / `imported`), serialized to a
  canonical, reversible string: `top` / `wall:3` / `hole:1/wall:2` /
  `replica[2]/wall:3` / `splinter(top)#1` / `gen:fillet:0` / `imported:5`.
- The wire form in `.fai.js` is the string pair `{ origin, role }`. A
  `display` name (`PartName`) is UI-only and never participates in identity or
  resolution.
- Identity is propagated by a **role table**: each op that produces a BREP shape
  attaches a `RoleTable` via `fromBrep(shape, { solid, roleTable })`; the
  executor auto-syncs `slot.roleTable` → `roleTableCache`. Surviving faces
  (hash unchanged) and modified successors (1→N) inherit; only genuinely
  *new* faces get a derived vocabulary (`replica[k]/…`, `splinter(#j)`,
  `gen:fillet:i`, `cap:…`, `wall:i`).

## Why not the obvious alternatives

- **`origin: PartName`** (the old form). Rejected: a `PartName` is a variable
  name that can be renamed and is *shared* across imports of one asset; it is
  not globally unique and is not stable across replay. `StmtId` is unique by
  construction and decoupled from naming.
- **Re-derive lineage by replaying statements.** Rejected: it re-runs geometry
  or re-infers argument binding on every query; the registration model costs
  nothing extra and is auditable.
- **Per-op custom `(face, index, args, inputRoles) => RoleName` function.**
  Rejected: an open function cannot be machine-checked for completeness, which
  G4 (declaration cost) requires. The six closed `ProvenanceKind`s let the
  generator/compiler fail on a missing declaration.
- **Keep the hash as identity.** Rejected outright: it is the root cause, not a
  representation choice.

## Consequences

- **G3 (anti-replay) is 6/6 green**: `g3-replay-chains.test.ts` — T0 link guard
  + 6 chains (extrude→fillet, extrude→cut, linearPattern, split, fai_drill,
  box→role-literal→fillet) all pass. T1 vocabulary-set equality now uses
  `Set` semantics because OCCT face ordinals are not stable across replays
  (the *set* of local names is).
- **G1 (coverage) is 0 unnamed faces**: `phase0-coverage-baseline.test.ts` —
  47/47 faces carry a semantic role, 0 positional, 0 empty.
- **Mesh does not participate** (D6): referencing a face/edge of a mesh Shape
  throws `E_TOPO_MESH_UNSUPPORTED`; `assignPrimitiveFaceRoles` / the `role:''`
  fallback were deleted.
- **`unmodeled` is an explicit accounting**, not a TODO: every op that cannot
  name its faces declares `naming: { kind: 'unmodeled', reason }` (a breaking
  requirement on third-party libs via D11). Audit:
  `unmodeled-whitelist.test.ts`.
- **3d_editor sync (H2/H3)**: changing `origin`/`role` changes the wire form of
  every stored `TopoRef`, so `../3d_editor` must migrate (`migrateTopoRef`) and
  update its two assertions. This is cross-repo and still open.

## Lineage wiring — resolved (§1.4/1.5)

The plan's `registerStep` lineage graph (one register function + two call
sites in `wrapBrepOne` and the `compatOp` boundary, §4.3) was **deferred to the
Phase 2.3 batch**; it is now **wired**. `registerStep` is `LineageGraph.register`
and the runtime singleton is `runtimeLineage`:

- The single register site lives in `define-op.wrapped`
  (`runtimeLineage.register`). Because `compatOp` is built **on top of**
  `defineOp` (not a parallel second path), generated projections and hand-written
  ops share that one site — no second call site is needed at the compat boundary.
- The graph is cleared at the start of `direct-executor.runCode`, so every full
  replay (`execute` / `append` / `update`) is self-contained and N3 never misfires
  on an edited statement from a prior run.
- Nested op calls (an impl invoking another op, or itself, under the same
  `getCurrentStmt()` anchor) are skipped via a module-level `registeringStmts`
  guard that must stay set for the **entire awaited impl** — an earlier version
  that cleared the flag synchronously after `register` still tripped N3 (9 red).
- N1/N2/N3 are now **active at runtime**. Carrier:
  `packages/tests/faijs/topology-naming/lineage-wiring.test.ts` (graph populated
  + replay idempotent).

**A plan defect this wiring exposed**: the extra `E_TOPO_PART_REDEFINED` guard
(§1.3) rejected legitimate **reassignment** (`part0 = cad.translate(part0, …)`),
regressing `api/dual-form-contract.test.ts` by 8. It was **removed**: identity is
`(StmtId, RoleName)`, a `PartName` is only a reverse-lookup index, so rebinding a
name is last-writer-wins (`stmtOf` / `nodeOfPart` have no production consumers
anyway).
