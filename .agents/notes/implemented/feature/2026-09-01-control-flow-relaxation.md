# Agent Note: Control-flow relaxation — conditional expressions + local functions (D1–D15)

Status: implemented

English | [中文](2026-09-01-control-flow-relaxation.zh.md)

## Problem

faijs (R10) banned all control flow; a loop-driven part (a gear, a pattern) could not be expressed, and any argument expression referencing a statement variable was rejected at parse time (`E_VALUE`). The roadmap (v2/v3) had already declared the destination — control flow lives inside sub-functions, the top level stays linear — but the language had not implemented any of it.

## Decision

Relax R10 to "no control flow at the top level" in one v1:

1. **Runtime expressions (`ExprIR`, Phase 1)**: when static folding fails because an expression references a *statement variable* (not a parameter/literal), the expression is kept verbatim as `ExprIR { $expr: { text, refs, params } }` and evaluated at runtime by the JS engine via an arrow wrapper `((names) => text)(ctx.names)`. The whitelist grammar is `Literal/Identifier/Unary/Binary/Logical/Conditional/Array` (recursive) — **no calls, no member access** (nested calls keep using `CallRefIR`), and `ObjectExpression` deliberately does not fall back as a whole (an object whose property values reference variables already works through `VarRefIR`, and whole-object fallback would wrongly swallow the top-level args container).
2. **Local functions (Phase 2)**: `function <name>(<params>) { <body> }` is parsed into `FunctionDefIR` (now with `bodyHash` + `bodyRange` + duplicate-name check), bodies may contain arbitrary control flow (`if/for/while/switch/try/throw/break/continue/labeled`, plus `var` — D12 keeps the status quo, no new tightening), and the top level may call them in four forms (assignment / re-assignment / destructuring / side-effect) via a bare-identifier callee.
3. **ABI (D7/D11)**: the compiled wrapper is `async function <name>(__ctx, __ns, <user params>)` — the user's parameter list is preserved verbatim after the two injected engine parameters; a call binds positional inputs to the first `M` parameters and the trailing object's keys to the remaining parameters by name (`E_ARG` on too many positionals / unknown key / collision), unbound parameters are `undefined`, and `keep`/`keepHidden` are stripped before binding.
4. **Keep isolation (D5)**: while a local function runs, `userFunctionDepth > 0` makes `registerKeep` a no-op — function-body `cad.*` internal keeps never pollute the outer statement; call-site `keep` is the only retention channel.
5. **Function BREP domain (D13)**: transient OCCT handles produced inside a function are registered (`registerFunctionBrep`, hooked in `fromBrep`) and released on return (`finally`, also on error), keeping only handles reachable from the return value — the body's intermediate geometry never enters the top-level `solidCache`.
6. **Content addressing (D6/P4)**: a local call's `statementKey` is `local.<callee>#<bodyHash>` — editing a function body invalidates every caller; untouched bodies cost zero recomputation.
7. **v1 scope cuts (D10/D9/D2/D15)**: a function body may **not** call another local function (the top-level ABI and the verbatim body semantics conflict; also a security narrowing); `export function` stays rejected; parameter declarations keep literal-only values; unknown function names are rejected at parse time (`E_REFERENCE`), so `check()` needs no symbol-stage extension.
8. **Execution guard (D8)**: optional `executionTimeoutMs` throws `ExecutionLimitError` (`E_EXEC_LIMIT`) on a whole-run timeout; a synchronous `while(true)` is a JS single-thread limit the guard cannot interrupt — real protection lives at the host layer.

## Alternatives considered

- **Store AST + mini-printer for `ExprIR`.** Rejected: zero-rewrite of user text (R13), no printer to maintain.
- **Allow nested calls inside `ExprIR`.** Rejected: keep the v1 evaluation surface narrow (D4); `CallRefIR` already exists.
- **Permit function-body calls to sibling local functions.** Rejected (D10): `gear(part0, { n: 3 })` inside a body would be a plain JS positional call (the whole object lands in the second parameter), semantically inconsistent with the top-level binding — and recursion would be unguarded.
- **Only a single injected `params` object in the wrapper.** Rejected (D7): the user's parameter names would never receive values.
- **Force function-body intermediate geometry to mesh-only.** Rejected as the primary plan (D13): value-level `hasBrep` dispatch already works inside bodies; the handle-registry domain keeps BREP alive with bounded memory.
- **Symbol-stage existence check for local calls.** Rejected (D15): parse-time rejection is the earliest and makes `check()` simpler.

## Consequences

- New top-level capabilities: runtime expressions in any argument value, and local function calls (four forms). Existing scripts without functions parse unchanged; parameter/literal expressions still fold exactly as before (zero regression).
- New diagnostics: `E_ARG` (ABI), `E_REFERENCE` (unknown local function), `E_STATEMENT` (duplicate function name, body-local call).
- The function body is user source embedded into the compiled module — a documented exception to "user text never reaches the VM" (R-3), bounded by the acorn gate + whitelist, isomorphic to the faqts whole-module channel.
- `derivePartName` gained an optional `excludeRanges` so a `partN` inside a function body does not skew top-level naming.

## Verification

- `expr-ir.test.ts` (21): ExprIR fallback for conditionals / arrays / objects (property-level), static-folding zero-regression, whitelist boundaries (`E_VALUE` for calls/members), arrow-wrapper emission, round-trip, `consumes()` C5 on `ExprIR` refs.
- `function-def.test.ts` (24): body control-flow matrix, safety red lines kept, four call forms, ABI matrix (`E_ARG`), duplicate/unknown-name rejection, `bodyHash` determinism, compile emission (wrapper + `localFns` + parameter-ordered ABI), round-trip.
- `function-execute.test.ts` (11): keep isolation, `bodyHash` incremental invalidation, timeout guard type, terminal-dag, BREP domain handle release (loop-heavy function: only the return value enters `solidCache`), module structure.
- Full core suite green (297 lang/cad-runtime tests including regressions); `npm run typecheck` passes.
