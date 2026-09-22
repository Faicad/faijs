# Agent Note: contour closure stop — a closed chain must not keep extending

Status: implemented

English | [中文](2026-09-20-contour-stop-at-closure.zh.md)

## Problem

After the greedy-restart fix, tap and slittingsaw still reported
`sketch-not-solved` with contours=0 while the solver itself converged. Probe
of the solved endpoints pinned it: the linker kept EXTENDING the chain after
it had already returned to the head. tap's profile apex (0,0) is touched by
both the closing segment (seg5) and a free segment (seg8, 0,0→-4,4); the
free segment was consumed into the chain, `closed` became false, and the
perfectly closed 6-segment loop was dropped. Same failure class as the
ballend steal, one step later in the chain.

## Decision

- `extractContours`: **stop at closure** — before each extension scan, if the
  chain already touches the head (`segments.length > 1 && near(tail, head)`)
  break out. First-come-first-served on closure: the chain that closes first
  keeps the segments; left-over free segments start their own (open, dropped)
  chains.
- **BIM WallTrace open-profile policy (settled, no code change needed)**:
  probed BIMExample — WallTrace* sketches are single open lines/polylines
  consumed ONLY by Part::FeaturePython Wall objects (already python-baked by
  H10). Nobody consumes the contour geometry; the open-profile sketch keeps
  its `pending-sketch-channel`-style note without blocking the file.

## Alternatives considered

- **Backtracking search over all candidate chains** — still deferred: both
  corpus failure classes (mid-chain steal, post-closure steal) are resolved
  by restart + stop-at-closure; revisit only if a three-way junction appears.
- **Emit open contours for wall traces** — rejected for now: no consumer
  reads them; adds ledger noise. Revisit with the BIM wall feature work.

## Consequences

- 56-sample sweep: ok 42→**43** (tap converts), checkFail 0.
  slittingsaw still gaps (its 11-line profile chains into the wrong loop
  first — same family, next iteration); BIMExample/TestTangentMode remain
  by policy/real topology.
- Tests: contour.test.ts +1 (tap's exact endpoint data; closure-stop
  GOTCHA). fcstd suite 13 files / 131 cases green.
