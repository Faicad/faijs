# Agent Note: `.fai.js` becomes a true JS subset — top-level call-argument restrictions removed (D1–D6)

Status: implemented

English | [中文](2026-09-04-true-js-subset-call-args.zh.md)

## Problem

`.fai.js` claimed to be "a legal JS subset", but top-level call arguments were not: the parser accepted only `Identifier` and `ObjectExpression` in argument position. Three consequences: bare literals were rejected (`cad.box(10, 20, 30)` → `unexpected argument type: Literal`); a second object argument silently overwrote the first (`tabAndSlot(p, tabSpec, slotSpec)` was unusable); member expressions were rejected, so a record field could not be read in the script (`hem(p0.solid, …)` failed and libraries needed an explicit `solidOf` terminal just to dig a field out of a part record). The positional form of the D11 dual-form API contract existed on the TS compat face only.

## Decision

The `StatementIR` argument model is replaced by a single positional slot (statement model: `positional: ArgIR[]`; the `inputs: PartName[]` field is removed; `args` survives only as the projection of the trailing plain-object argument):

1. **D1 — positional is the single source**: every argument position accepts the full expression forms. A trailing plain object is the options slot (`args` projection); object arguments in non-final positions are kept as-is — no overwrite, no merge.
2. **D2 — `ExprIR` whitelist widens**: `MemberExpression` (object chain walk; identifiers become refs) and non-namespace `CallExpression` are accepted as runtime expressions; namespace-rooted calls inside expressions are still rejected (`E_VALUE`), as are `new` / arrow / `await`.
3. **D3 — refs = consumption**: `collectStatementRefs`, keep validation, terminal-dag `consumes()` (C2/C5), downstream computation, `emitBrepLost` and the reference precheck all derive from the `positional` slot (variable references and expression identifiers count; literals and non-trailing objects do not).
4. **D4 — expression evaluation failure is a statement failure**: the compiled module wraps `ExprIR` evaluation in a try/catch throwing a module-local `__FaiExprEvalError` marker class (zero imports); the executor converts only that marker into `OpError(E_EXPR)` → `ExecutionResult.failedAt`. All other exception semantics unchanged (impl exceptions still propagate as bugs).
5. **D5 — multi-object positional**: every object argument survives; `splitPositionalOptions` extracts the trailing object for the ABI/options paths (compile emission, keep stripping, codeToArgs).
6. **D6 — host contract**: `codeToArgs` returns `{ positional, args }` (marker objects `{$ref}/{$param}/{$call}/{$expr}` stay in `positional`; hosts degrade to read-only); `formatCodeLine` accepts `positional` + optional legacy `args`; the code printer emits the trailing options object in the `{ k:v, … }` args-slot style, and a keep-only object disappears entirely after stripping.

The compile path emits every positional element in its IR form (`$param`/`$ref` → `ctx.<name>`, `$call` → awaited query, `$expr` → arrow wrapper); the incremental `statementKey` serializes the whole `positional` slot (keep stripped) instead of `args` alone.

## Alternatives considered

- **Keep `inputs` alongside `positional`** (dual bookkeeping). Rejected: two sources of truth drift apart; every consumer had already been patched twice.
- **Whole-run try/catch in the executor for D4.** Rejected: it would convert genuine impl exceptions (bugs) into statement failures, breaking the "impl exception = bug = propagate" contract and existing `rejects.toThrow()` semantics; the marker-class approach converts only expression-evaluation failures.
- **Keep member access rejected, route `p0.solid` through `CallRefIR`-like special forms.** Rejected: invents syntax for what plain JS already expresses; the runtime-evaluated `ExprIR` mechanism already existed.
- **Have `codeToArgs` return the trailing object inside `positional` only.** Rejected: hosts doing edit backfill would double-write or lose the options object; the explicit two-slot split is the backward-compatible superset.

## Consequences

- `.fai.js` is now a true JS subset at the call site: `cad.box(10, 20, 30)`, `tabAndSlot(p, tabSpec, slotSpec)`, `hem(p0.solid, { kFactor: 0.44 })`, `cad.box(w * 2, h, d)` all parse and execute. Old-form scripts (object-only) are a strict subset — zero migration.
- Libraries no longer need an object-form entry for every script-face function, nor a `solidOf` terminal just to expose a record's geometry field (it remains available for the TS compat face).
- `runtime-state` compile cache and incremental keys change shape (positional serialized) — content addressing still guarantees cross-version correctness; a one-time full recompute after upgrade is acceptable and expected.
- 3d_editor follow-up (separate repo): its `codeToArgs` consumers should adopt the `{ positional, args }` contract; until then the old object-form behavior is preserved there.
- New diagnostics: `E_EXPR` (runtime expression evaluation failure attributed to the owning statement).

## Verification

- Parser: positional literals / mixed forms / multi-object / member expressions / foldable expressions; red lines (`new`, arrow, namespace-rooted call in expr) still rejected; legacy object-form scripts re-parse to equivalent IR (all fixtures re-parsed, zero drift).
- Compile/execute: `cad.box(10,20,30)` ≡ `cad.box({size:[10,20,30]})` geometry parity (mesh + brep); `E_EXPR` failure attribution; incremental invalidation through positional changes; keep-strip emission (`union(a, b, { keep: [a, b] })` compiles to `union(ctx.a, ctx.b)` with no stray `{}`).
- codegen/host: round-trip fidelity (`statementIRToLine` → parse → same IR), `codeToArgs` new-contract tests, `formatCodeLine` legacy-args compat.
- Full core suite green (76 files / 996 tests), mech-lib green, lint + typecheck clean.
