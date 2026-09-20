# Agent Note: contour extraction greedy-chain fix (sketch-not-solved 13→4)

Status: implemented

## Problem

After H10 and the H7 first cut, `sketch-not-solved` was the top first-cause
of conversion gaps (13 of 47 failing files — 11 of them the CAM tool-bit
family: ballend, bullnose, endmill, radius, reamer, slittingsaw, tap,
thread-mill, taperedballnose, test-path-tool-bit-shape-00,
test_28534_truncated_pocket; plus BIMExample, TestTangentMode3-0.21).
Diagnosis showed the sketches were NOT unsolved: every one reported L0 with
`loopCount=0` — the solver converged, the contour extractor found nothing.

## Root cause (pinned by a minimal repro)

`extractContours` chained segments greedily but kept scanning the pool in
the same pass with the drifted tail. When several segments share an endpoint
(the tool-bit profiles have a y=50 top edge built from collinear pieces plus
a free rotation-axis segment and a bottom free segment), a later-indexed
segment touching the NEW tail stole the chain before the correct
earlier-indexed continuation was reached; the loop broke and the extractor
returned 0 contours for a perfectly closed 6-segment profile (arc + 5 lines).

## Decision

One-line fix in `fcstd/contour.ts`: after EVERY successful match, restart
the pool scan (`break` out of the candidate loop; the while-loop re-enters
from the start). Locked by a GOTCHA test built from the exact ballend
endpoint data (8 segments incl. 2 free ones → must yield a closed ≥5-segment
loop).

## Alternatives considered

- **Filter construction geometry upstream** — orthogonal, not a fix: the
  axis lines in these files carry no construction flag in the parsed data
  (sketch-parse has no construction marker at all); filtering is a separate
  piece of work and the chain bug would corrupt any profile that has
  duplicate endpoints regardless.
- **Backtracking link search (try all candidates, keep the closed run)** —
  more robust in theory, but the restart alone resolves the corpus failure
  class; revisit if a profile with three-way endpoint junctions appears.

## Consequences

- 56-sample sweep: ok 23→**32**; `sketch-not-solved` first-cause 13→4.
  Remaining sketch-not-solved mentions: BIM WallTrace profiles are genuinely
  OPEN wall traces (single line / open polyline — an open-contour policy is
  needed, not a bug); TestTangentMode has a real free-segment topology;
  TestSketchCarbonCopy is the known delta-exceeds-t1 L1 case.
- fcstd suite: 12 files / 121 cases green (new GOTCHA test included).
- The `pending-sketch-channel` reason on translated sketches in these files
  is pre-existing (M10.5 chain wiring), unchanged by this fix.
