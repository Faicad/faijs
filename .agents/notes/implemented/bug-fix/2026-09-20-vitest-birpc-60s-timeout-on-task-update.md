# Agent Note: vitest 3.x birpc hard 60s worker RPC timeout → false "onTaskUpdate" failure

Status: implemented

English | [中文](2026-09-20-vitest-birpc-60s-timeout-on-task-update.zh.md)

## Problem

`pwsh scripts/publish-all.ps1 -Tag next -DryRun` aborts inside `scripts/ci.ps1`:
the `faijs-tests` package finishes **all green (1609 passed + 3 skipped, 0 failed)**
yet exits 1 with one unhandled error:

```
[vitest-worker]: Timeout calling "onTaskUpdate"
```

## Root Cause

vitest 3.x hard-codes `const DEFAULT_TIMEOUT = 6e4` (60s) inside birpc
(`node_modules/vitest/dist/chunks/index.B521nVV-.js:3`). `createForksRpcOptions` and
`createThreadsRpcOptions` (`utils.CAioKnHs.js`) pass **no** `timeout`, so every worker
RPC falls back to the 60s cap. `createBirpc` at `index.B521nVV-.js:21` only uses
`DEFAULT_TIMEOUT` when `options.timeout === undefined`; at line 56 the timer is armed
when `timeout >= 0`.

The 60s cap measures a worker's cumulative **synchronous** busy time without returning
to the event loop — not a single test's wall-clock. Confirmed with pure-sync-block
probes (no faijs code): one 70s block → error; three 30s blocks in one worker → error.

Triggering suites in this repo:
- `faijs/compat-e2e/gear-lib-demo-flow.test.ts` (P26 §8.4): each `runtime.execute(SCRIPT)`
  is ~7–10s (one cold build + 4 downstream statements through the compat bridge); the
  whole §8.4 scenario accumulated > 60s in one worker.
- `faijs/parity/parity.test.ts` "parity-screw": a single brep `execute` is 34.5s (mesh
  only 0.3s); under CPU contention it reached 66.9s.

faijs `execute` is a synchronous native geometry computation and cannot yield the event
loop, so injecting `await` yields does not shrink the atomic 34.5s brep block.

## Decision

Two parts, both applied:

1. **Split the heavy suites** so no single worker file crosses the threshold by itself:
   the §8.4 scenario was split into `gear-lib-demo-flow` / `gear-lib-demo-recompute` /
   `gear-lib-demo-recompute-lib-change` (sharing `gear-flow-fixture.ts`); the
   `parity-screw` fixture runs as its own serial pass via the two-phase `test` script in
   `packages/tests/package.json`.

2. **Bump the worker RPC timeout from 60s to 5min** by patching the vitest dist: added
   `timeout: 300000` to the objects returned by `createThreadsRpcOptions` and
   `createForksRpcOptions` in `node_modules/vitest/dist/chunks/utils.CAioKnHs.js`. This
   overrides `DEFAULT_TIMEOUT` at `index.B521nVV-.js:21`.

## Caveats (important)

- The `timeout: 300000` patch lives **only in `node_modules`** — it is NOT tracked by
  git and is wiped on any `npm install` / `npm ci` that re-resolves vitest. It must be
  re-applied after reinstall until vitest is upgraded.
- **Preferred long-term fix:** upgrade vitest to 4.x, which passes `timeout: -1` to
  `createBirpc` (#vitest-dev/vitest#8297). Remove the node_modules patch after upgrade.
- 300s aligns with the per-package CI watchdog (`FAIJS_TEST_BUDGET_MS`, default 300000ms
  in `scripts/ci.ps1`); the watchdog remains the real deadlock guard.

## Verification

- Before: `tests` package all-green but `Errors 1 error` → exit 1 → `publish-all.ps1` aborts.
- After (split + patch): `npm run test -w @faicad/faijs-tests` (two-phase) → exit 0, no
  unhandled error.

## References

- vitest-dev/vitest#8164 (report), #8297 (fix shipped in v4).

## Alternatives considered

- **Upgrade vitest to 4.x now.** Rejected for this change: v4's fix (`timeout: -1` to `createBirpc`, #8297) was not available at the time; it remains the preferred long-term fix, after which the node_modules patch must be removed.
- **Only split the heavy suites, leave the 60s cap in place.** Rejected: the atomic 34.5s brep `execute` block cannot be split further, and under CPU contention a single suite crossed 66.9s — the cap itself must be raised.
- **Raise the worker RPC timeout via a node_modules patch + split the heavy suites** (adopted): `timeout: 300000` in `createThreadsRpcOptions`/`createForksRpcOptions` overrides `DEFAULT_TIMEOUT`, and the split keeps any single worker below the threshold.

## Consequences

- `publish-all.ps1` no longer aborts: the `faijs-tests` package finishes all-green with exit 0 and no unhandled `onTaskUpdate` timeout.
- The `timeout: 300000` patch lives only in `node_modules` — it is not tracked by git and is wiped by any `npm install`/`npm ci`; it must be re-applied until vitest is upgraded.
- 300s aligns with the per-package CI watchdog (`FAIJS_TEST_BUDGET_MS`, default 300000ms in `scripts/ci.ps1`); the watchdog remains the real deadlock guard.
