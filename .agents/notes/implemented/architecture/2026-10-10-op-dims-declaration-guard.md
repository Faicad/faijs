# Agent Note: op dimension declaration guard (paramDims mandatory)

Status: implemented

English | [中文](2026-10-10-op-dims-declaration-guard.zh.md)

## Problem

The `paramDims` field on `defineOp`/`compatOp` was optional. Of 152 ops, only 22 had declarations. A new op could be added without any dimension declaration, and nothing would catch the omission — `cad.extrude(sk, { length: 20 })` (bare number on a dimensioned param) would silently pass without generating `20 * MM` or triggering `E_DIM_BARE_NUMBER`.

The user asked: "Is there a way to guarantee that dimension declarations are not forgotten when new ops are added, and that the declaration only needs to be maintained in one place?"

## Decision

Make `paramDims` (or `spec`) **mandatory** on every `defineOp`/`compatOp` call, enforced by a three-layer mechanism:

1. **Source-level AST guard** (`scripts/check-op-dims.mjs`): scans all `defineOp`/`compatOp` call sites in `packages/core/src/api/`, `packages/faijs-extra/src/ops/`, and other package `src/` directories. Fails CI if `paramDims` or `spec` is absent. Also cross-checks JSDoc `@param` unit annotations (e.g. `(mm)`) against declared dims.

2. **Runtime invariant test** (`packages/core/test/lang/op-dims-invariant.test.ts`): drives the full `cad` namespace (platform + editor ops), asserts every dual-op function has a non-empty entry in `getOpDims()`, and validates that `paramDims` values are all legal `DimName | 'plain'`.

3. **Type system**: `DimParamValue = DimName | 'plain'` — `'plain'` marks a numeric parameter as intentionally dimensionless (e.g. `segments: 64`). It is NOT a second exemption channel; it is the same declaration with a different value, so every numeric parameter is explicitly accounted for.

The declaration remains a single source of truth: `CadRuntime.getOpDims()` aggregates it at runtime; the dimension check pass (`extractMetadata`) and codegen unit-literal serialization (`n * MM`) both consume the same table. No second table is maintained.

## Alternatives considered

- **Op-level `dimless: true` exemption**: Rejected by the user — an op-level switch would exempt future new parameters too, which is exactly the漏洞 (loophole) we're closing.

- **Branded types (`Dim<'length'>`)**: Rejected — TS types are erased across the JS VM boundary; `20 * MM` in a script is a bare `number` at runtime, so the brand cannot survive. And `segments: 64` would still need a "dimensionless brand", which is just renaming.

- **Full auto-derivation from implementation signatures**: Rejected — parameter dimensions are a language/runtime contract (the semantics of `20 * MM` in scripts), not something implementation types can express. Auto-derivation would create a second place where dimension knowledge lives, violating the "one place only" requirement.

## Consequences

- All 152 ops now have `paramDims` (or `spec`) declarations.
- `scripts/check-op-dims.mjs` is wired into `ci.ps1` and `ci.sh` as a hard gate.
- The `DimParamValue` type (`DimName | 'plain'`) is exported from `@faicad/faijs/units`.
- `docs/api-contract.md` §10.3 documents the dimension declaration discipline (bilingual).
- `'plain'` parameters have zero behavior change: no unit-literal wrapping, no dimension check — identical to pre-D8 bare output.
- Existing fixtures/tests that use bare numbers for dimensioned params are exposed as pre-existing violations (not new breakage); fixing them is a follow-up task.
