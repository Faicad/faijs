/**
 * Manual diagnostic — SKIPPED unless `FAIJS_RPC_PROBE=1`.
 *
 * Positive control for the trigger documented in `../worker-yield.js`: a worker
 * that never returns to the event loop for 60s cannot read the response of its
 * pending `onTaskUpdate` RPC, so birpc's hard-coded timeout fires and vitest
 * reports an unhandled error — exit code 1 with every test green.
 *
 * Run:
 *   FAIJS_RPC_PROBE=1 <node> node_modules/vitest/vitest.mjs \
 *     run faijs/_support/probes/on-task-update-timeout-trigger.probe.test.ts
 * Expected: "Tests 1 passed" AND `Error: [vitest-worker]: Timeout calling
 * "onTaskUpdate"` AND exit code 1.
 *
 * Counterpart: `on-task-update-timeout-yield.probe.test.ts` (same load, yields
 * between blocks, expected exit code 0).
 */
import { describe, expect, it } from 'vitest'

const enabled = process.env.FAIJS_RPC_PROBE === '1'

function blockMs(ms: number): void {
  const t = Date.now()
  while (Date.now() - t < ms) {
    /* spin: no await, no I/O — the event loop must not advance */
  }
}

describe.skipIf(!enabled)('probe: continuous 70s synchronous block', () => {
  it('keeps the worker off the event loop past the 60s RPC budget', () => {
    blockMs(70_000)
    expect(true).toBe(true)
  }, 200_000)
})
