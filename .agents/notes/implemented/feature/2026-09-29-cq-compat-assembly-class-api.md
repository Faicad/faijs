# Agent Note: CadQuery Assembly class-style API for cq-compat-assembly

Status: implemented

English | [中文](2026-09-29-cq-compat-assembly-class-api.zh.md)

## Problem

`@faicad/cq-compat-assembly` had `buildAssembly`/`solve`/`toCompound`/`save`/`constraint`/`constraintEx` but `CqAssembly` only exposed `solve()` and `toCompound()` as methods. CadQuery 2.8.0's `Assembly` class has `add`/`addSubshape`/`remove`/`traverse`/`load`/`importStep`/`export` — all missing. The manifest had 52 entries blocked with the reason "class-style API cannot be expressed in .fai.js restricted subset", which was stale: object methods + reassignment (`let asm2 = asm.add(...)`) work fine in the statement model.

## Decision

Implemented the missing methods with **immutable semantics** (return new `CqAssembly`, not mutate-and-return-self), deliberately diverging from CQ's mutable `add`/`remove` to fit `.fai.js`'s explicit-assignment model.

- **add/addSubshape/remove** (work item A): `add` accepts `Shape | {shape, name?, color?}`, generates `part_<n>` default names, rejects duplicates. `remove` filters dangling constraints (divergence from CQ: faijs `assemblyOp` validates constraint references at construction time, so dangling constraints cannot enter the compound).
- **traverse** (work item B): generator yielding `[name, assembly]` pairs. Flat structure yields single element; nested assemblies deferred.
- **importStep/load** (work item C): Node-side STEP import via `loadBrep` + `fromBrep`, producing a single-member assembly. `load` is an alias.
- **export** (work item D): reuses existing `save`.
- **manifest** (work item E): 52 stale blockedBy reasons updated to "API implemented, parity mirror pending". 8 real gaps (`constraintEx` missing FixedPoint/FixedAxis/PointInPlane) left unchanged — cross-deferred to P0-3.

## Alternatives considered

- **Mutable semantics (CQ-faithful).** `add` returns `this` after mutation. Rejected: `.fai.js` statement model uses explicit `let asm2 = asm.add(...)`; mutable self-return would make `asm` and `asm2` alias the same object, breaking the expectation that reassignment creates a new binding.
- **Keep dangling constraints on remove (CQ-faithful).** CQ's `remove` doesn't delete associated constraints (solver reports unreachable refs in `unsupported`). Rejected: faijs `assemblyOp` validates constraint references at construction — a `buildAssembly` with dangling refs throws. Filtering is the only way to avoid a construction-time crash without adding a `skipValidate` escape hatch.
- **Split multi-solid STEP into multiple members.** CQ's `importStep` creates one member per solid. Deferred: current `loadBrep` returns a single compound shape; splitting requires `kernel.getSubShapes` decomposition — not needed for P0-1 acceptance.

## Consequences

- `CqAssembly` interface now has `add`/`addSubshape`/`remove`/`traverse` + `constraints`/`subshapes` fields; `buildAssembly` injects all method implementations.
- New exports: `CqSubshape`, `AssemblyAddArg` types; `importStep`, `load` functions (Node-side, in `save.ts`).
- 15 new tests in `assembly-class-api.test.ts` (A: 8, B: 2, C: 3, Q4 probe: 1, e2e: 1); package total 36 passed / 5 files.
- 52 manifest entries updated (blockedBy reason); 8 remain (real `constraintEx` gaps).
- `mini_lathe` e2e still fails on pre-existing `fillet: KERNEL_ERROR` (not introduced by this change).