# Agent Note: contour DFS with backtracking — junction dead-ends no longer sink loops

Status: implemented

English | [中文](2026-09-20-contour-dfs-backtracking.zh.md)

## Problem

slittingsaw (11-line tool-bit profile) still gapped after both earlier
contour fixes: several segments share the y=0 axis (a long center line,
notch segments, free branches). First-come chaining from a seed walked INTO
seg2's far endpoint (-50,0) — a dead end — consumed its segments, and the
real 8-segment loop never closed (contours 0, solver fine). This is the
third failure class of the same greedy linker: mid-chain steal (ballend),
post-closure steal (tap), and now junction dead-ends.

## Decision

- `extractContours` chains via **DFS with backtracking**: at each endpoint,
  try every unused candidate continuation; the FIRST walk that closes at the
  seed's head wins; a dead branch returns its segments to the pool
  (`cand.used = false`) and the next alternative is tried. The previous
  ad-hoc rules (pool restart, closure stop) are subsumed by the DFS
  ordering and were deleted.
- Exponential worst case is bounded in practice: profile pools are ≤ dozens
  of segments and most endpoints are 2-way; junction-heavy corpora are
  exactly where the old linker already failed, so the search terminates at
  the first closure.

## Alternatives considered

- **Priority heuristic (prefer the candidate closest to the head / with the
  fewest shared endpoints)** — rejected: heuristics guess; backtracking
  proves closure. Slittingsaw's junction had no local signal distinguishing
  the winning continuation.
- **Eulerian-path / planar-face traversal (proper half-edge mesh)** — the
  principled fix, but a much larger change; revisit if DFS shows pathological
  runtime on real corpora (batch phase will tell).

## Consequences

- 56-sample sweep: ok 43→**44** (slittingsaw converts; its 8-segment loop
  found through the dead-end branch), gap 13→12, checkFail 0.
  sketch-not-solved drops to 2 (BIMExample by open-profile policy,
  TestTangentMode real topology).
- Tests: contour.test.ts +1 (slittingsaw's exact 11-line endpoint data →
  ≥8-segment closed loop). fcstd suite 13 files / 132 cases green.
- Remaining 12 failures are all genuine feature/geometry work (Draft
  objects, EngineBlock, compound members, external geo, fillet/cut chains,
  delta-exceeds-t1, PocketTest blank entry to triage).
