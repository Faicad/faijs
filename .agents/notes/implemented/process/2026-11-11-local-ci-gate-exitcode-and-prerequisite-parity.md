# Agent Note: local CI gate reads a shadowed $LASTEXITCODE; prerequisites and budgets now mirror the GitHub workflow

Status: implemented

English | [中文](2026-11-11-local-ci-gate-exitcode-and-prerequisite-parity.zh.md)

## Problem

`scripts/ci.ps1` finished a run with `==> All CI checks passed (总耗时 1580.9s)` while five
stages had actually failed: the workspaces typecheck (TS2345/TS2352 in a new test file), two
watchdog kills (`@faicad/faijs` at 600 s with 304/454 test files done, `@faicad/faijs-tests`
at 300 s with 84/86 done), `check-op-dims`, the API-coverage gate
(`CadRuntime: missing [consumeRule]`), and both demo e2e steps
(`browserType.launch: Executable doesn't exist`). None of them reached `$script:failures`.

Root cause: `$LASTEXITCODE = 0` at script scope. `$LASTEXITCODE` is a **global** variable that a
native command overwrites; an unqualified assignment inside a script creates a script-scope
shadow that native commands never update, so every `if ($LASTEXITCODE -ne 0)` read the initial 0.
`pwsh -File ci.ps1` masked the bug, because a `-File` body runs in the global scope where the
unqualified assignment lands in `$global:` anyway — the gate's behaviour depended on *how* the
script was invoked (`& ./scripts/ci.ps1` → toothless, `pwsh -File` → working).

Two of the failures were pure local/remote drift rather than code: `ci.yml` had
`node scripts/fetch-test-kernels.mjs` (multi-version brepkit kernels, gitignored) and
`npx playwright install chromium`, `ci.ps1` had neither. That is why 16 brepkit assertions and
50 demo e2e assertions were red locally and green on GitHub.

## Decision

1. `$global:LASTEXITCODE = 0` on the first assignment and `$global:LASTEXITCODE` at every read in
   `ci.ps1`. The gate no longer depends on the invocation mode.
2. `ci.ps1` runs the same prerequisites as `ci.yml`, in the same order: brepkit kernels are
   fetched in stage 3/8 right after the build; the demo stage installs chromium before
   `test:e2e`. Both steps are idempotent.
3. Per-package watchdog budgets are **measured, not guessed**: `@faicad/faijs` 1500 s (full
   suite ≈910 s on a 4-core box: 304/454 files inside 600 s, the remaining 150 took 310 s and
   passed 639 assertions), `@faicad/faijs-tests` 600 s, `@faicad/faijs-fasteners` 600 s. The same
   table is mirrored in `ci.yml`, which previously gave `@faicad/faijs` the 300 s default —
   tighter than local.

## Alternatives considered

- **`$?` instead of `$LASTEXITCODE`.** `$?` only reflects the last statement and is reset by the
  `Write-Host` calls inside `Step`; rejected.
- **Keep the initialisation but read `$global:LASTEXITCODE` only at the checks.** It works, but
  leaves a line whose comment invites the same bug back. Both halves are on `$global:` now.
- **Document `pwsh -File` as the only supported invocation.** The gate would stay silently green
  for anyone using `& ./scripts/ci.ps1`, which is exactly how the failing log was produced. Fix
  the cause, not the call site.
- **Raise budgets through `FAIJS_TEST_BUDGET_MS`.** A single global override cannot express three
  package sizes; the per-package table is kept as the single source and mirrored into `ci.yml`.
- **Make the multi-version brepkit tests `skipIf` the kernels are missing.** batchB/batchD/intersect
  already skip; batchA/batchC/clone/parity fail hard. Skipping everywhere would have hidden the
  drift behind this log. The asymmetry is kept and recorded here as an open inconsistency rather
  than silently unified.

## Consequences

Local and remote CI now agree on what they check, so a green local run means something. The cost
is honest: a local run is ~35–40 minutes (it was already that long — it only lied about the
outcome), and the first run after a clone downloads ~195 MB of Chromium plus the two brepkit
tarballs.

`@faicad/faijs` needs ~910 s of its 1500 s budget on four cores; a much slower machine will still
trip the watchdog. That is deliberate: the budget is a deadlock detector, not a performance
target. When either pipeline gains a step or changes a budget, change the other one in the same
commit — the `ci.yml` header already asks for step alignment.
