# Agent Note: IR code deleted and gates migrated (T5, final step of the no-IR dual-channel runtime)

Status: implemented

English | [中文](2026-09-07-no-ir-t5-delete-ir-code.zh.md)

## Problem

After T1–T4 (P1–P4 flip), the runtime default was direct, but the IR code path (`lang/parser.ts` semantic layer, `lang/compile.ts`, `cad-runtime/module-executor.ts`, `cad-runtime/terminal-dag.ts`) was still present and consumers could still reach it. The R11 red line required A-16/A-17/A-14 parity gates to be green before deletion; that precondition was met.

## Decision

T5 deleted the IR code and migrated the gates:

1. Deleted `lang/parser.ts` (parseScript semantic layer, importDeclToIR, folding), `lang/compile.ts` (compileToModule, CompiledStatementMeta), `cad-runtime/module-executor.ts` (ModuleExecutor, ExecBookkeeping, Namespaces — the latter migrated to `direct-executor.ts`), and `cad-runtime/terminal-dag.ts` (computeLeafTerminals, consumes, DagRuntimeView — replaced by `live-shapes.ts`).
2. `lang/types.ts` stripped of ScriptIR/StatementIR/ImportIR/FunctionDefIR/ArgIR types and factories; kept ParamDef/TerminalShape/ScriptMetaIR/VarKind.
3. `lang/codegen.ts` StatementIR dependency switched to HostArg-face input.
4. `runtime.ts` simplified: `directFailedAtOrThrow` now keeps all execution errors in `failedAt` (no re-throw for business parameter errors); removed `BrepUnsupportedError`/`MeshUnsupportedError`/`OpError` imports that were only used for the old re-throw branch.
5. Parity tests (A-16/A-17/A-14) converted from direct-vs-module comparison to direct-only behavior verification (snapshots固化).
6. `api/load.ts` error paths switched from plain `Error` to `OpError` so they land in `failedAt` via the direct catch path.
7. Tests updated: chamfer, topology-naming, refactor-acceptance, gear-lib-demo tests that expected `.rejects.toThrow` for parameter validation errors now check `result.failedAt` (direct-only semantics: all statement-level errors land in failedAt).
8. `runtime.test.ts` migrated from `executeIR`/`makeStmt`/`makePartScript` helpers to direct `execute(code)` calls; `plan()` tests deleted (plan was an IR-only API).

## Alternatives considered

- **Keep re-throwing business parameter errors, only catch engine capability errors**: rejected — in direct-only mode, all errors from the DirectExecutor catch block are statement-level failures; re-throwing some breaks the uniform `failedAt` contract and forces hosts to try/catch around `execute`, which the module path never required.
- **Keep the module path as a dead-code fallback**: rejected — the plan explicitly requires deletion (T5/P6), and keeping dead code invites accidental re-coupling.

## Consequences

- The runtime is direct-only: `extractMetadata → DirectExecutor → computeLiveShapes` is the single execution path. No `parseScript`/`compileToModule`/`ModuleExecutor`/`terminal-dag` remains.
- `ExecutionResult.failedAt` is the single error channel: all execution errors (OpError, BrepUnsupportedError, MeshUnsupportedError, TypeError, business parameter errors) land in `failedAt` and are never re-thrown. `ParseError` is still thrown (syntax-level, before execution).
- 3d_editor contract (§4.10 U1–U12/R1–R4) unchanged: `failedAt` surface (index/callee/message/lineNo) is additive; hosts reading the first three fields are unaffected.
- `no-ir/parity/` tests are direct-only behavior snapshots; they continue to pass and serve as regression anchors.
