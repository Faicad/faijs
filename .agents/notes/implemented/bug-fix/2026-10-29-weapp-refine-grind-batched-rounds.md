# Agent Note: weapp refine grind — batched rounds that close on timeout

Status: implemented

English | [中文](2026-10-29-weapp-refine-grind-batched-rounds.zh.md)

## Problem

On device, the weapp refine flow ground for minutes after `execute`: the refine
status flickered refine→idle→refine while parts were re-tessellated over and over.
Three mechanisms compounded:

1. **Timeout semantics.** A round that hit `REFINE_TIMEOUT_MS` reverted the
   controller to `idle`, from which zoom re-fired the same full-batch request.
   Each re-fire redid all the work from scratch (faijs before 0.45.17 had no
   same-density skip), so a timeout guaranteed another full round on the next
   zoom — the grind loop.
2. **One-shot batching.** `fire()` sent the entire target list as a single
   `retessellate` request. One slow part doomed the whole batch to the per-request
   budget (5 s; device per-part L1 measures 3.4-9.4 s), so most rounds timed out
   with nothing landed.
3. **Re-armed rounds redid finished work**, because same-density requests were
   full work in the engine.

## Decision

Refine rounds advance in batches and close on timeout
(`packages/weapp/src/core/refine-controller.ts`, with the wire widened in
`packages/platform/src/execution/protocol.ts`, `instruction-core.ts` and
`contract.ts`):

- `REFINE_BATCH_SIZE = 1` (overridable via `RefineTiming.batchSize`). `fire()`
  snapshots targets and hands them to `runRound()`, which slices by batch size,
  sends one `retessellate` request per batch, and **applies each batch on
  arrival** — partial refinement lands instead of being lost to a timeout. A
  per-batch timeout is re-armed per batch. Batch size 1 keeps most device parts
  under the 5 s budget (batches of 2 measure ~7 s on device, over budget);
  inter-batch `postMessage` cost is negligible on both platforms, and disarm
  stays effective at batch boundaries.
- **Timeout closes the round as `refined`**, not `idle`: the round's generation is
  bumped, the phase is set once, and one `RefineTimeoutError` is reported. A
  closed round cannot be re-fired by zoom; the next `execute` re-arms cleanly.
  In-flight responses from the killed round are dropped by the generation check.
  A rejected request still returns to `idle` with `onError` (retryable —
  unchanged semantics).
- **Platform wire:** `RetessellateSkippedPart.reason` widens to
  `'no-solid' | 'same-density'`, and `instruction-core` routes
  `{ skipped: 'same-density' }` results into the `skipped` list without copying
  geometry — consuming the faijs 0.45.17 idempotent skip, so re-armed rounds pay
  ~nothing for already-refined parts.

Pinned by tests: `refine-controller.test.ts` (batch progression with per-batch
apply, disarm between batches stops the round, mid-round timeout closes it and
drops late responses, a batch reject ends the round in `idle`, `batchSize`
override, timeout-then-zoom does not re-fire, a fresh arm restores refinement)
and `instruction-core.test.ts` (same-density results land in `skipped` with the
reason, no geometry transfer).

## Alternatives considered

- **Bigger batches (5-10) for throughput.** Measured against: device per-part L1
  is 3.4-9.4 s against a 5 s per-batch budget; larger batches push most batches
  over budget and end the round earlier with less landed work.
- **Keep timeout→idle and rely on the engine skip alone.** Rejected: zoom would
  still re-request every part each time; the skip makes re-requests cheap, but
  the round churn (status flicker, repeated wire traffic) remains.
- **Per-part timeout with round continuation** (skip a slow part, keep going).
  Rejected: without per-part progress from the worker, a hung request cannot be
  told apart from a slow one; closing the round and letting the next `execute`
  re-arm is deterministic.
- **Adaptive batch sizing from observed per-part timings.** Deferred: there is no
  measurement channel yet; the constant 1 is the measured optimum for current
  device per-part costs.

## Consequences

- The grind loop is broken at both ends: rounds land work incrementally
  (per-batch apply survives timeouts), a timeout ends refinement for the round
  instead of restarting it, and re-armed rounds skip already-refined parts via
  the engine's same-density skip (node repro: second identical round 2.2 s →
  55 ms, zero updates).
- Zoom during an active round disarms it at the next batch boundary and re-arms
  with fresh targets; after a timeout-closed round, zoom does nothing until the
  next `execute` re-arms.
- The timeout error is reported once per round, not once per batch.
