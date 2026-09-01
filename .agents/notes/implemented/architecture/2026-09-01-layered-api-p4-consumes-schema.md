# Agent Note: Layered API port — P4 L3 end-to-end (consumes + schema metadata on defineOp)

Status: implemented

English | [中文](2026-09-01-layered-api-p4-consumes-schema.zh.md)

## Problem

P0–P3 landed the layered stack (kernel → L0/L1 → L2 vendored), but the L3 API surface was still the old opaque function chain: whether a function "consumed" its shape inputs was decided by runtime `keep()`/`keepHidden()` calls inside the function body, and no machine-readable parameter metadata existed for codegen or UI parameter panels. The P4 gate is the first L3 end-to-end milestone: extend `defineOp` with two static fields (D2) and wire the first three operators (`box`/`cylinder`/`union`) through the whole host path — `.fai.js` text → parse → execute → terminals → host-facing `ExecutionResult`.

## Decision

1. **Static consumption declaration (`consumes`, D2 G3/G4)** — `DefineOp` acquires an optional `consumes?: 'all' | 'none' | number[]` field, carried on `DualOpMeta` and validated by `assertLibConforms` at library-assembly time. Semantics: `'all'` (default, means a boolean/transform owns its operands), `'none'` (pure query/creator — does not hide operands), `number[]` (consume exactly the listed input positions). `base defineOp` validates `consumes`/`schema` are well-formed.
2. **Runtime view reads the declaration** — `DagRuntimeView.opConsumes(stmt)` resolves the callee through the runtime's libs registry (`libs[ns][callee]` → `DUAL_OP_META.consumes`) so `computeLeafTerminals`/`consumes()` can use the static declaration instead of inferring from the function body. The C-rule chain becomes C0 (keep) → C2 (static consumes) → C3 (all non-geometric outputs) → C5 (default). A kept variable (C0) still wins over any declaration.
3. **Three ops annotated in-place** — `box`/`cylinder` declare `consumes: 'none'` + a `schema` parameter map; `union` declares `consumes: 'all'`. Both `schema` and `consumes` ride on `DualOpMeta` and are available from the function object via `DUAL_OP_META` for codegen / UI panels.
4. **Runtime consumption path unchanged** — the runtime still honors the function body's `keepHidden()` (the static declaration is additive; the O6 takeover of consumption semantics by the declaration alone is explicitly deferred).
5. **P4 acceptance suite** — `packages/tests/faijs/p4-l3-e2e/`: host-path `.fai.js → execute → terminals → ExecutionResult` (asserting `naming`, `brepSolids`, `topology` and the key-11 field surface), plus C2 unit coverage in `terminal-dag.test.ts` (static `'none'`/`number[]` keep upstream shapes terminal; absent declaration falls through to C5; call-site keep still wins), and D2 metadata assertions on `defineOp` + the three stdlib ops.

## Alternatives considered

- **Derive static consumption by executing the function body** (parse `keep()`/`keepHidden()` calls at runtime). Rejected: it ties terminal derivation to execution and defeats the "zero signature knowledge" goal; static declaration is queryable without loading the callee.
- **Keep L3 consumption declarative but separate from `defineOp`** (a parallel registry keyed by callee). Rejected: `DUAL_OP_META` already rides the function object, so lookup is O(1) through the existing libs registry with no second registration surface.
- **Make the static declaration fully replace `keepHidden()` now** (full O6 takeover). Rejected for P4: changing how the three ops absorb operands is a behavior change that must be migrated op-by-op with parity; P4 lands the metadata + terminal wiring, the takeover stays on the P6 track.

## Consequences

- A third-party operator can now declare its consumption statically; host code sees nothing, but terminal derivation honors the contract without executing the function body.
- The three stdlib primitives carry machine-readable `consumes` + `schema` metadata today; the rest of the API surface and the corresponding codegen/UI consumption are L3 follow-ups (P6 alignment).
- Every check is green: core typecheck, `check-layer-boundaries` (150 vendored files), export JSDoc, translation pairing, and the full vitest suites (core 880 passed / 9 skipped, stdlib 46, tests 638 including the P4 acceptance, C2 and metadata cases).