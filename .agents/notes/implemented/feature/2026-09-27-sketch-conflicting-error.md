# Agent Note: Sketch conflicting over-constraint is a hard error on the script face

Status: implemented

English | [中文](2026-09-27-sketch-conflicting-error.zh.md)

## Problem
The 2026-09-26 sketch design let *conflicting* over-constraints pass (best-effort solve + diagnostic), with only a redundant over-constraint flagged but still allowed. The user ruled on 2026-09-27 that a conflicting over-constraint must be a hard error on the faijs scripted face, while a *redundant* over-constraint stays allowed but must notify the host (never silent).

## Decision
`shapeFromSolved` (`faces.ts`) throws `E_SKETCHC_CONFLICTING` when `SolveOutcome.status === 'conflicting'`. The message lists the clashing constraints resolved to element tags + values (e.g. `length(bottom) = 80`), never bare solver indices.
- The code is distinct from `E_SKETCHC_SOLVE_FAILED` (which stays for hard solver failure).
- The scripted-face op boundary auto-unwraps the error into `failedAt` — unchanged mechanism, now the desired behavior rather than a bug.
- The diagnostic event sink still fires for `conflicting`, so the host UI gets structured detail alongside the error.
- `SolveOutcome` gains `conflictDetails?: ConflictDetail[]`, populated by `solveSketch` at the canonical layer (the planegcs backend only knows numeric geoIds, not canonical tags, so tag resolution cannot live there).
- The fcstd compat layer is unaffected: it consumes the low-level `SketchSolver.solve()` + `extractContours` path and never `shapeFromSolved`, so it keeps tolerating conflicts (best-effort), per its own FCStd-compatibility contract.

## Testing
- `cad.sketch` on a conflicting sketch fails at the sketch statement; `failedAt.message` contains `E_SKETCHC_CONFLICTING` and the conflicting element tag names + values.
- A redundant sketch still solves and emits a diagnostic event; it does not error.
- fcstd conversion of a conflicting third-party sketch still succeeds (tolerance unchanged).

## Alternatives considered
- Keep conflicting allowed (old D3): the user ruled it must error.
- Raise the error at the capability layer (`solveSketch` / `SketchSolver`): it would also break fcstd, which shares the capability; the error boundary is intentionally only at the scripted-face `shapeFromSolved`.
- Resolve conflict tags inside the planegcs backend: the backend has no canonical tags; tag resolution lives at the canonical layer.

## Risks
- `get_gcs_conflicting_constraints()` returns **every** conflicting member. The numeric-index fallback remains only as a safety net for solvers that report nothing.

## Consequences
- The scripted face rejects conflicting sketches with a stable, host-readable error code and a structured diagnostic event.
- fcstd third-party conversion keeps its best-effort conflict tolerance because the boundary is confined to `shapeFromSolved`.
- The canonical `solveSketch` layer now carries conflict details that tag resolution needs, decoupling the planegcs backend from tag naming.