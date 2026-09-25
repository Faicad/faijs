# Agent Note: A6 arduinounomissblack stack overflow resolved by topology lineage rework

Status: implemented

## Problem

Plan §A6 (`docs/plans/2026-09-25-fcstd-full-conversion-plan.md`) tracked a `Maximum call
stack size exceeded` crash on `Electronics Parts/Boards/Arduino/Arduino UNO/arduinounomissblack.FCStd`
(3 samples). The crash fired during the BREP topology build inside `cliRun` (mode `brep`),
and the initial hypothesis was an unbounded recursion in the topology/selector build
("疑似血统回走或布尔嵌套").

## Decision

No code change to faijs core is needed for A6. The crash no longer reproduces against the
current `main` source. The root cause was eliminated by the prior topology lineage rework
— in particular `066b225` (roleTable demoted to cache + lineage back-walk engine) and
`cdabba0` (wire §1.4/1.5 lineage registration), plus the surrounding Phase 2.x topology work.

A regression guard was added in the consumer harness (fcstd-port) at
`test/FreeCAD/a6-stack-overflow-regression.test.ts`. It materializes the product container
and runs it through `cliRun` (mirroring `tools/run-sweep-worker.ts`), then asserts the run
does **not** throw `Maximum call stack size exceeded` and reaches completion.

## Alternatives considered

- **Re-entrancy guard in `collectDirectResult`** (`topologyCollecting` flag that skips a
  nested topology build). Rejected. Instrumentation proved `buildBrepTopology` and
  `buildSelectorRuntimeData` are each entered ≤4 / ≤15 times — they are *not* the recursion
  site. The guard also had no behavioral effect: after fully reverting it, 10/10 runs still
  completed cleanly. It would have been defensive cruft for a problem that no longer exists.
- **Treat as non-deterministic and loop-guard it.** Rejected. A genuine infinite recursion
  fails ~100% deterministically; 13/13 clean runs (guard on and guard off) prove the
  recursion path is gone, not merely masked.

## Consequences

- A6 is closed; no faijs-core diff is required.
- `fcstd-port/test/FreeCAD/a6-stack-overflow-regression.test.ts` pins the product so a future
  reintroduction of an unbounded recursion in the topology/selector build is caught.

## GOTCHA (stack-trace truncation)

When chasing a `Maximum call stack size exceeded`, the default `Error.stackTraceLimit`
(=10) truncates the stack to the *outermost* 10 frames and hides the recursive helper under
a linear-looking frame (`buildSelectorRuntimeData`) that is itself non-recursive. Always bump
`Error.stackTraceLimit` (e.g. 2000) before capturing the stack, and instrument entry counts
on the suspected functions to distinguish "recursion inside one call" from "re-entrant
calls". Without that, the truncated trace misleads the root-cause search.
