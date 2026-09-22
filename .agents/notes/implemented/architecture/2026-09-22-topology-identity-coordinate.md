# Agent Note: topological face identity is the causal coordinate (StmtId, RoleName)

Status: implemented

English | [中文](2026-09-22-topology-identity-coordinate.zh.md)

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

## Alternatives considered

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
  `unmodeled-whitelist.test.ts`. **⚠️ Not yet true for bare-function libraries** —
  see "Third-party part libs" below: those are lifted through a hardcoded blanket
  `unmodeled` default that the whitelist excludes from its audit.
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

## Downstream consumer: assembly constraints

The plan's §1 opening chain ends "in the parameters of `fillet` / `cut` /
`drill` / **`assembly`**". The in-repo end of that chain is
`core/src/api/assembly/types.ts:47`:

```
EntityRef = { part: PartName; face: FaceRef }
FaceRef   = { topoRef: FaceTopoRef } | { surfaceType, center, normal }
```

Two orthogonal identity layers meet here, and only one belongs to this design:

- `part: PartName` is **instance identity** (which part) — a name, not a
  coordinate; not this design's concern.
- `face` is **face identity** (which face it attaches to) — this design supplies
  `topoRef`; the geometric snapshot is only a fallback.

Assembly **solving** (constraints → transforms, `api/assembly/solve.ts`, brepjs
solverAdapter since P1) is orthogonal to this design and predates it; assembly
**referencing** is its demand side. ⇒ This design's largest downstream is
**in-repo**, not `../3d_editor`.

## Third-party part libs — D11 has no landing point as written (§2.11)

Measured; the plan's two premises are wrong:

1. `fai_cq_gears` / `fai_cq_warehouse` / `sheetmetal` are **workspace packages of
   this repo** (root `package.json` `workspaces`), not sibling repos — so §2.11
   is in-repo work, not cross-repo.
2. They call **zero** `defineOp` / `compatOp`. They export bare `Result`
   functions (e.g. `spur_gear()`: no geometry input, one kernel build → solid),
   lifted by `registerLib`'s `autoLift`. So "add `naming` to each `defineOp`" has
   no landing point.

The real state: `cad-runtime/admit-compat-lib.ts` hardcodes, for **every** bare
function,

```
naming: { kind: 'unmodeled', reason: 'admitCompatLib: bare function lift, provenance not declared' }
```

— a blanket default, which is exactly the bypass D11 rejects, and it is excluded
from `unmodeled-whitelist.test.ts`'s audit. There is currently **no library-level
or function-level `naming` declaration channel** (`registerLib` only takes
`autoLift?: boolean`; `admitCompatLib` recognises only a bare function's
`fn.outputs` annotation, not `fn.naming`).

**Consequence of declaring `unmodeled` — the real cost**: `ROLE_ASSIGNERS` in
`roles.ts` covers only `box` / `cylinder` / `cone` / `sphere`, and the positional
fallback was deleted (Phase 1.7) ⇒ any op outside those four contributes **no
role** → `role: null` → **no `topoRef`**. A part lib declaring `unmodeled`
therefore forces its faces onto the geometric snapshot in assembly, which drifts
numerically once parameters change. Axis-type assembly (`EdgeRef.axis` /
cylindrical-face axis) is purely geometric and **unaffected** — that is the exact
boundary within which "part libs need no topology" holds.

⇒ §2.11 order: **① add a declaration channel → ② libs declare explicitly →
③ only then may the blanket default become a hard failure.** Skipping ① and
doing ③ would immediately break loading the three libs.
