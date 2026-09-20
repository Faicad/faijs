/**
 * Yield the vitest worker for at least one full event-loop iteration —
 * including a poll cycle — so the worker can service its RPC channel to the
 * main process.
 *
 * Why this exists
 * ---------------
 * vitest's worker <-> main channel is a birpc instance with a hard-coded 60s
 * call timeout (`const DEFAULT_TIMEOUT = 6e4` in vitest's bundled birpc;
 * `createThreadsRpcOptions` / `createForksRpcOptions` pass no `timeout`, and no
 * config key or env var reaches `createRuntimeRpc`, so 60s is NOT adjustable on
 * vitest 3.x). A call whose response is not read within 60s rejects with
 * `[vitest-worker]: Timeout calling "onTaskUpdate"`; vitest reports that as an
 * unhandled error, which sets exit code 1 even though every test passed
 * (vitest-dev/vitest#8164; fixed upstream in #8297 by disabling the timeout).
 *
 * The response can only be read when the worker returns to the event loop, and
 * vitest's per-test bookkeeping is microtask-only: consecutive synchronous
 * native blocks (OCCT / manifold wasm geometry) accumulate into ONE stretch in
 * which the worker never reaches a poll phase. Measured 2026-09-19 on this box
 * (4 cores, this package, one file per run):
 *   - one continuous 70s synchronous block            -> trips the 60s timeout
 *   - three consecutive 30s blocks (no test above 30s) -> trips it as well
 *   - `faijs/parity` alone (screw execute 35s)         -> green
 *   - the same screw test with 2 sibling heavy workers -> 66.9s, trips it
 *
 * `setTimeout` is required — not `setImmediate`, and not `setTimeout(…, 0)`:
 * those resolve in the check / timers phase, and the test body is resumed by a
 * microtask *inside the same iteration*, before the pending IPC response is
 * read. Waiting a few ms keeps the loop in a blocking poll phase long enough to
 * read the response that is already sitting in the socket, which clears the
 * birpc timer.
 *
 * Keep `ms` small: callers only pay it when the worker was actually busy.
 */
export function yieldWorkerRpc(ms = 10): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}
