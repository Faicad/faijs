/**
 * Package-wide worker guard for the RPC timeout documented in
 * `./worker-yield.js`.
 *
 * vitest's between-test bookkeeping never returns to the event loop, so
 * geometry-heavy tests in the same file accumulate into one un-yielding stretch
 * (measured: three 30s blocks — no test above 30s — already trip the 60s
 * `onTaskUpdate` timeout). Yielding after a busy test breaks that accumulation
 * so each test's own stretch is what counts against the 60s budget.
 *
 * Registered through `setupFiles` in `packages/tests/vitest.config.ts`; tests
 * shorter than the threshold pay nothing.
 */
import { afterEach, beforeEach } from 'vitest'
import { yieldWorkerRpc } from './worker-yield.js'

/**
 * Below this a test cannot possibly matter: the RPC window is 60s, and only
 * stretches measured in tens of seconds ever get close to it.
 */
const BUSY_MS = 2000

let startedAt = 0

beforeEach(() => {
  startedAt = Date.now()
})

afterEach(async () => {
  if (Date.now() - startedAt >= BUSY_MS) await yieldWorkerRpc()
})
