# Agent Note: No-IR dual-channel runtime — drop the intermediate IR

Status: proposed

English | [中文](2026-09-06-no-ir-dual-channel-runtime.zh.md)

## Problem

Every new feature request forces parser changes: `parseScript` is both a semantic extractor and a code generator, and `ScriptIR` is consumed by both the execution channel (`compileToModule`) and the UI channel (`analyzeCode` / parameter editing / timeline / DAG terminal judgment). Syntax restrictions live in the semantic-extraction layer because IR consumers demand the flat "one line = one op call" shape. The user requires: cancel the parser semantic layer, hand `.fai.js` source directly to the JS VM, and delete the intermediate IR.

## Proposal

- Execution channel runs source directly on the JS VM: remove the `parseScript → ScriptIR → compileToModule → ModuleExecutor` pipeline; `DirectExecutor` consumes source text (shared ctx + optional identifier scope-lifting + import light transform).
- The parser degrades to a metadata extractor (not limited to line data): output `UiMetadata` (line-level statement summaries, param table, import table, function table, block structure, refs, keep) serving only the UI channel; it never generates executable code, evaluates, or participates in execution.
- UI and execution channels are decoupled; the only optional shared point is identifier scope-lifting (text-level, using outputs/line-boundary info from metadata).
- Incremental append = execute new units on the shared ctx (line number is the statement boundary); update = full re-run (accepted by the user).
- Terminal judgment switches from static DAG leaves (`terminal-dag`) to runtime live-shape judgment `computeLiveShapes` (keep-driven `consumes()` C0/C3/C5 unchanged + keep); `ExecutionResult.terminals` / `TerminalShape` stays field-compatible, host zero-change.
- Multi-file = `ProjectLoader` + module registry + implicit exports (live shapes ∪ constants ∪ functions); cross-file references are not consumption.
- Timeline keeps its per-line node model; loop/condition blocks become single read-only nodes (source text, no semantic analysis, no ×N aggregation).

## Alternatives considered

- **Keep ScriptIR but consume it only from the UI channel**: rejected — every new syntax would still require extending the IR shape and its consumers; the root cause of "every feature change requires parser changes" remains.
- **Mandatory per-line LHS rewriting**: rejected — hosts that self-report outputs can skip it; rewriting is an optional optimization, not a contract.
- **Keep deps-closure incremental update**: rejected — the user accepts full re-run (R3); a v2 line-level dependency graph can be rebuilt from line-level refs.
- **Timeline shows loop iterations as ×N aggregates**: rejected — the user explicitly said loops have unbounded possibilities and ×N aggregation is infeasible; read-only block nodes suffice.

## Acceptance criteria

- `execute` / `append` / `update` text entry signatures unchanged; host zero-change surface (`result.terminals` field-compatible, `failedAt` keeps `index`/`callee`/`message` and adds `lineNo`).
- Golden-data parity gates (mandatory before IR deletion): on the full existing `.fai.js` fixture set, ① `MetadataExtractor` output == `parseScript`-derived summaries (per-field equal); ② `DirectExecutor` result == current `executeIR` result (per-entry equal); ③ `computeLiveShapes` == `computeLeafTerminals` (per-entry equal, including hidden and kind). IR code may only be deleted after these stay green in CI.
- `libLoader` / `registerLib` contract unchanged, third-party libraries zero-change; relative imports go through the module registry.
- Zero stderr across the whole pipeline; doc-sync all green.

## Risks

- Parameter-edit reference-form fidelity (HostArg ref vs value) — line-level metadata fidelity plus read-only expression rows.
- Read-only block node product shape — fixed as a single read-only node showing source text (R8); UI details confirmed with 3d_editor.
- Test-suite migration volume (parser/compile/terminal-dag test rewrites) — concentrated in P6, locked by golden-data comparison.
