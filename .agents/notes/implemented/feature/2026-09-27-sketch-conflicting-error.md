# Agent Note: Sketch conflicting over-constraint is a hard error on the script face

Status: implemented

## Problem
The 2026-09-26 sketch design let *conflicting* over-constraints pass (best-effort solve + diagnostic), with only a redundant over-constraint flagged but still allowed. The user ruled on 2026-09-27 that a conflicting over-constraint must be a hard error on the faijs script face, while a *redundant* over-constraint stays allowed but must notify the host (never silent).

## Proposal
- `shapeFromSolved` (faces.ts) now throws `E_SKETCHC_CONFLICTING` when `SolveOutcome.status === 'conflicting'`. The message lists the clashing constraints resolved to element tags + values (e.g. `length(bottom) = 80`), never bare solver indices.
- The code is distinct from `E_SKETCHC_SOLVE_FAILED` (which stays for hard solver failure).
- The script-face op boundary auto-unwraps the error into `failedAt` — unchanged mechanism, now the desired behavior rather than a bug.
- The diagnostic event sink still fires for `conflicting`, so the host UI gets structured detail alongside the error.
- `SolveOutcome` gains `conflictDetails?: ConflictDetail[]`, populated by `solveSketch` at the canonical layer (the planegcs backend only knows numeric geoIds, not canonical tags, so tag resolution cannot live there).
- The fcstd compat layer is unaffected: it consumes the low-level `SketchSolver.solve()` + `extractContours` path and never `shapeFromSolved`, so it keeps tolerating conflicts (best-effort), per its own FCStd-compatibility contract.

## Alternatives considered
- Keep conflicting allowed (old D3): rejected — the user ruled it must error.
- Raise the error at the capability layer (`solveSketch` / `SketchSolver`): rejected — that would also break fcstd, which shares the capability; the error boundary is intentionally only at the script-face `shapeFromSolved`.
- Resolve conflict tags inside the planegcs backend: rejected — the backend has no canonical tags; tag resolution belongs at the canonical layer where tags live.

## Acceptance criteria
- `cad.sketch` on a conflicting sketch fails at the sketch statement; `failedAt.message` contains `E_SKETCHC_CONFLICTING` and the conflicting element tag names + values.
- A redundant sketch still solves and emits a diagnostic event; it does not error.
- fcstd conversion of a conflicting third-party sketch still succeeds (tolerance unchanged).

## Risks
- `get_gcs_conflicting_constraints()` returns **every** conflicting member in the validated scenario (confirmed by the 2026-09-27 test run: the rectangle's `length(bottom)=80` vs `length(top)=60` both appear as `length(bottom) = 80` / `length(top) = 60` in the message, so the assertion for both `80` and `60` holds). The numeric-index fallback remains only as a safety net for solvers that report nothing.
