/**
 * Manual diagnostic — SKIPPED unless `FAIJS_RPC_PROBE=1`.
 *
 * Negative control for the trigger documented in `../worker-yield.js`: the same
 * total synchronous load as the positive control, but with a real event-loop
 * yield between blocks, so the worker services its RPC channel and the 60s
 * `onTaskUpdate` timeout never fires.
 *
 * Run:
 *   FAIJS_RPC_PROBE=1 <node> node_modules/vitest/vitest.mjs \
 *     run faijs/_support/probes/on-task-update-timeout-yield.probe.test.ts
 * Expected: "Tests 3 passed" and exit code 0 (no unhandled error).
 *
 * Counterpart: `on-task-update-timeout-trigger.probe.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { yieldWorkerRpc } from '../worker-yield.js'

const enabled = process.env.FAIJS_RPC_PROBE === '1'

function blockMs(ms: number): void {
  const t = Date.now()
  while (Date.now() - t < ms) {
    /* spin: no await, no I/O — only `yieldWorkerRpc` advances the loop */
  }
}

describe.skipIf(!enabled)('probe: 90s of work in 30s slices with a yield between', () => {
  for (let round = 1; round <= 3; round++) {
    it(`round ${round}: 30s block, then yield`, async () => {
      blockMs(30_000)
      await yieldWorkerRpc()
      expect(true).toBe(true)
    }, 200_000)
  }
})
