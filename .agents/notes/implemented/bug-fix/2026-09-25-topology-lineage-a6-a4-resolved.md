# Agent Note: A6/A4 topology lineage failures resolved by lineage rework

Status: implemented

## Problem

Plan §A6 (`docs/plans/2026-09-25-fcstd-full-conversion-plan.md`) tracked a `Maximum call
stack size exceeded` crash on `Electronics Parts/Boards/Arduino/Arduino UNO/arduinounomissblack.FCStd`
(3 samples). The crash fired during the BREP topology build inside `cliRun` (mode `brep`),
and the initial hypothesis was an unbounded recursion in the topology/selector build
("疑似血统回走或布尔嵌套").

Plan §A4 tracked a sibling signature on `Electrical Parts/Batteries/battery-AAA.fcstd`
(19 samples): `chamfer: edgeRef: edge ordinal N out of ...` and
`edgeRef: adjacent face ordinal N has no role lineage`. Same family of defect — `edgeRef`'s
face references could not resolve a role through the upstream lineage table (A2's fillet
signature is the same root cause, but its sample `Beds.FCStd` still blocks on unimplemented
B1/B2 features, so no product zip exists to run).

## Decision

No code change to faijs core is needed for A6 or A4. Neither signature reproduces against
the current `main` source. Both root causes were eliminated by the prior topology lineage
rework — in particular `066b225` (roleTable demoted to cache + lineage back-walk engine) and
`cdabba0` (wire §1.4/1.5 lineage registration), plus the surrounding Phase 2.x topology work.

Regression guards were added in the consumer harness (fcstd-port):
`test/FreeCAD/a6-stack-overflow-regression.test.ts` and
`test/FreeCAD/a4-edge-ref-regression.test.ts`. Each materializes its product container and
runs it through `cliRun` (mirroring `tools/run-sweep-worker.ts`), then asserts the run
reaches completion without the corresponding failure signature (`Maximum call stack size
exceeded` for A6; `edgeRef` / `no role lineage` for A4).

A4 evidence: 3/3 `cliRun` runs clean, and the vitest guard passes. A6 evidence: 13/13 clean
runs (guard on and off) plus the passing vitest guard.

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

- A6 and A4 are closed; no faijs-core diff is required.
- `fcstd-port/test/FreeCAD/a6-stack-overflow-regression.test.ts` and
  `fcstd-port/test/FreeCAD/a4-edge-ref-regression.test.ts` pin their products so a future
  reintroduction of the unbounded recursion / role-lineage gap is caught.
- A2 (fillet, same lineage root cause) is expected to be cleared by the same rework, but its
  sample `Beds.FCStd` still blocks on unimplemented B1/B2 features (`Loft002`,
  `Compound001`) — A2's run-stage verification must wait for those.

## GOTCHA (stack-trace truncation)

When chasing a `Maximum call stack size exceeded`, the default `Error.stackTraceLimit`
(=10) truncates the stack to the *outermost* 10 frames and hides the recursive helper under
a linear-looking frame (`buildSelectorRuntimeData`) that is itself non-recursive. Always bump
`Error.stackTraceLimit` (e.g. 2000) before capturing the stack, and instrument entry counts
on the suspected functions to distinguish "recursion inside one call" from "re-entrant
calls". Without that, the truncated trace misleads the root-cause search.
