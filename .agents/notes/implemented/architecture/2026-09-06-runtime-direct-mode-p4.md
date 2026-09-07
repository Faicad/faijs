# Agent Note: CadRuntime gains a guarded DirectExecutor mode (P4 of the no-IR dual-channel runtime)

Status: implemented

English | [中文](2026-09-06-runtime-direct-mode-p4.zh.md)

## Problem

P1–P3 delivered IR-free MetadataExtractor / DirectExecutor / computeLiveShapes and their parity gates (A-16 / A-17 / A-14), but `CadRuntime.execute/append/update` still always ran the IR chain (parseScript → compileToModule → ModuleExecutor) and `collectResult` still decided terminals with computeLeafTerminals over the ScriptIR DAG. The runtime itself had no way to run in the IR-free mode, so the two execution channels only existed side by side in tests.

## Decision

CadRuntime now supports an opt-in IR-free execution channel without touching the default:

1. **`CadRuntimeOptions.executor: 'module' | 'direct'`** (4th constructor arg; default stays `'module'`). `CadRuntime` constructs a `DirectExecutor` in direct mode and re-syncs its namespaces on `registerLib` (same update point as ModuleExecutor).
2. **Public entries branch**: `execute` → `executeDirectText` (full run), `update` → `updateDirectText` (R3 full rerun of the new text), `append` → `appendDirectText` (DirectExecutor.append executes only new line numbers on the shared ctx). The module branch is byte-for-byte unchanged.
3. **Direct result assembly** (`collectDirectResult`) mirrors `collectResult` with the input side swapped: outputs / compounds from ctx shape/compound structural checks; statementCache synced from the ctx with content keys (E8 getCachedOutput keeps working); terminals from `computeLiveShapes` (line entries from the `metadata.keep` table, function-body registrations from `DirectExecutor.keepByLine`, explicit `terminalShapes` honored first); brepSolids for terminals + compound members when a kernel exists; host-injected topology passthrough.
4. **failedAt** gains an optional `lineNo` (additive; hosts reading index/callee/message are unaffected); direct-mode failures carry the precise source line.
5. **AppendPrefixError semantics preserved**: append metadata is extracted with `looseVars: true` (mirroring the module append parse) and a new `DirectExecutor.missingPrefixVar()` validates new units against the persistent ctx before execution — a missing reference throws AppendPrefixError so hosts upgrade to a full execute.
6. **`DirectExecutor.reset()` now clears the function-body keep registry** — a full re-execution must not leak the previous scene's per-line keep registrations (the runtime parity suite caught this when a later fixture inherited an earlier fixture's `keepHidden` at the same line numbers).
7. **E4 execution options are wired on the direct path**: `ExecuteOptions.beforeStatement` fires once per actually-executed unit (first argument = unit id `'s'+lineNo`, matching the new StatementSummary id so hosts locate summaries without breaking; second = the line number) and `executionTimeoutMs` is forwarded to `DirectExecutor`, which checks the whole-run deadline between units and throws `ExecutionLimitError` (`E_EXEC_LIMIT`) instead of recording a failedAt. The error class moved to a leaf module (`cad-runtime/execution-limit-error.ts`) so both the module path (`Promise.race`) and the direct path share it without a runtime↔direct-executor import cycle; runtime re-exports it to keep the host import surface unchanged. The keep sink is cleared in a `finally` so an interrupted run (timeout/ParseError) cannot leak the sink to the next execution.

## Verification

`packages/tests/faijs/no-ir/parity/runtime-direct-mode.test.ts` (46 cases): a direct-mode CadRuntime and a module-mode CadRuntime produce equal outputs (content keys), terminals (id + hidden), and compounds across the whole mesh-runnable fixture corpus, plus runtime face semantics: append incrementality, update full rerun, AppendPrefixError, failedAt lineNo/callee, getCachedOutput after direct execute, and direct-vs-module equality on a box→translate chain. Core suite (84 files / 1226), tests suite (73 files / 1520), typecheck, and lint are all green.

## Alternatives considered

- **Flip the runtime default to direct in the same change**: rejected — direct result assembly does not yet reproduce the module path's BREP topology/naming/changed/ activeValues surfaces (solidCache sync and per-part role tables are still module-executor-owned), so only mesh-mode parity is locked; the default stays module until those surfaces converge (full P4 flip and P6 deletion are gated separately).
- **Keep prefix validation inside DirectExecutor throwing AppendPrefixError**: rejected — AppendPrefixError lives on the runtime surface; the executor reports the first missing {unitLine, varName} and the runtime raises the host-facing error.
- **Share collectResult by parameterizing its inputs**: rejected — collectResult reads ModuleExecutor internals (getMetas / getCachedKey / internalKeep / ctx); a separate assembly keeps the direct path free of any IR/executor coupling (so P6 can delete the module side without touching the direct side).

## Consequences

- `CadRuntime` can now execute a mesh scene without parseScript/compile/ModuleExecutor/ terminal-dag; all R11 gates (A-16/A-17/A-14 plus the new runtime-level parity) are green, so IR deletion is still permitted nowhere (module path remains live).
- The module mode and all its consumers are untouched: the constructor is additive, the default is `'module'`, and no test or host changed its call shape.
- Known direct-mode gaps, tracked for the full P4/P6 switch: activeValues (keep-syntax §5.2 non-geometry leaves), changed (assembly bookkeeping), auto BREP topology/naming.