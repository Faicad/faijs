# Agent Note: DirectExecutor and computeLiveShapes land (P2–P3 of the no-IR dual-channel runtime)

Status: implemented

English | [中文](2026-09-06-direct-executor-live-shapes-p2-p3.zh.md)

## Problem

After P1 (MetadataExtractor, A-16 parity green), the execution chain still goes parseScript → compileToModule → ModuleExecutor (the IR middle layer). Under the no-IR dual-channel plan (R11 red line), an IR-free executor (DirectExecutor) and an IR-free liveness decision (computeLiveShapes) must exist before any IR deletion, and A-17 / A-14 parity must lock them equal to the current path (executeIR / computeLeafTerminals).

## Decision

P2–P3 landed with no IR code deleted; the execution chain and collectResult still use the current path (dual-path coexistence):

1. **P2 DirectExecutor** (`cad-runtime/direct-executor.ts`):
   - Splits `.fai.js` source into top-level statement units (line number = unit boundary), mechanically transforms each unit (ctx hoisting + await insertion + keep-key stripping + top-level function hoisting + destructuring write-back), and runs it in the JS VM inside an async wrapper;
   - one shared `ctx` survives execute/append/update; append only runs new line numbers; update = clear ctx and run the whole text (R3);
   - a failing unit produces `failedAt` (index/callee/message + lineNo);
   - imports neither parser.ts nor compile.ts nor the IR types.
2. **A-17 parity** (`packages/core/src/cad-runtime/direct-executor.test.ts`, 48 cases):
   - execute geometry outputs equal CadRuntime.executeIR case-by-case in mesh mode (flat op-line fixture corpus, content-key comparison);
   - append / update / top-level function / destructuring / param injection / failedAt line coverage.
   - fixtures needing fonts/assets/registered libs (text/engrave/load/third-party) fail on both sides in the bare environment, so they are outside the mesh corpus (covered by integration tests once the host injects the ports).
3. **P3 computeLiveShapes** (`cad-runtime/live-shapes.ts`):
   - input = metadata.lines/blocks/keep table + ctx shape variable names + function-body keep registrations (KeepView: per-line entries + function-body registrations, replacing ModuleExecutor.internalKeep);
   - algorithm mirrors computeLeafTerminals line-for-line: hidden precomputation (last keep declaration wins) → lastProducer (one forward pass + Map overwrite) → per-candidate consumption check (keep-driven consumes, C0/C3/C5 short-circuit; input switched to StatementSummary HostArg shapes);
   - free-JS blocks = lexical reference scan (not triggered by flat code).
4. **A-14 dual-path parity** (`packages/tests/faijs/no-ir/parity/a14-live-shapes.test.ts`, 40 cases): after the same runtime execution, computeLiveShapes and computeLeafTerminals outputs (id set + hidden) are equal case-by-case (fixture corpus, mesh mode).

## Alternatives considered

- **Switch the runtime to DirectExecutor first (P4), then verify**: rejected — R11 demands parity before switch/delete; P2/P3 deliver independently and the gates stay clean.
- **computeLiveShapes keeps an IR-shaped statement-model consumes**: rejected — the plan requires the liveness input side to move to StatementSummary too, otherwise P6 cannot delete terminal-dag.
- **DirectExecutor keeps deps / expression folding / outputs projection**: rejected — that would still be an IR execution mediator; this implementation only does textual, mechanical transformation.

## Consequences

- The three deletion gates (A-16/A-17/A-14) are green on the CI corpus, so the R11 precondition is satisfied; parser/compile/module-executor/terminal-dag are still in use, so no deletion PR is permitted yet.
- UI channel, execution channel, and terminal decision each now have an IR-free form; P4 (runtime switch) can proceed incrementally and P6 (IR deletion) is guarded by parity.
- DirectExecutor v1 supports flat op lines + top-level functions + container bodies (top-level `return` ignored); loops/conditionals (free-JS block execution) are deferred to P5 (the read-only A-6 block nodes are already covered by MetadataExtractor).
