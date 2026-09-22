# Agent Note: Pocket ThroughAll supported — and the marker-leak guard it forced

Status: implemented

English | [中文](2026-09-20-pocket-throughall-and-marker-guard.zh.md)

## Problem

The 3 CAM demo files (hole_puzzle, motor_mount_inch, strange_part_with_holes)
blocked on `pocket-type-ThroughAll-unsupported` after the Body-chain fix.
Implementing ThroughAll also exposed a second trap: these files have NO
PartDesign::Body at all (loose features + SubShape caches), so the
BODY_CHAIN_BASE marker from the previous fix was never retargeted and leaked
into generated JS as `cad.subtract(::body-chain-base::, part3)` — a parse
error killing the whole file (motor_mount_inch check-fail).

## Decision

- **ThroughAll translates like Length** with a deep prism (depth 1e6 mm,
  signed by Reversed): FreeCAD truncates the through prism against the base
  solid, so an oversized depth is exact after the subtract. Locked by a
  GOTCHA test (Type='ThroughAll' → translated, 2 calls, deep in cut
  direction).
- **Marker-leak guard in codegen**: after the Body-fold step, any feature
  whose calls still carry BODY_CHAIN_BASE (no Body, or no chain head yet) is
  downgraded to an explicit `pocket-missing-dependency` gap — the marker can
  never reach generated code.
- **Old bake-table assertion updated** (`feature-type.test.ts`): "pocket
  ThroughAll must bake" was the M9.3-era contract; positive coverage now
  lives in feature-translate.test.ts.
- Corpus follow-up on record: the 3 Body-less CAM files carry `SubShape`
  result caches and no Body chain — a future `shape-asset`-style resolution
  (like H7 Part::Feature) is the likely path; deferred.

## Alternatives considered

- **Compute the real base bbox depth for ThroughAll** — rejected: the
  translator has no base geometry; an oversized constant is exact because
  subtract truncates. 1e6 mm stays far inside float precision.
- **Leak guard = substitute the marker with the profile var** — rejected:
  subtracting from the wrong operand silently produces wrong geometry;
  an explicit gap is honest.

## Consequences

- 56-sample sweep: ok 37, checkFail 1→0 (the leaked-marker parse failure is
  gone); the 3 CAM files regress from ThroughAll-unsupported back to
  pocket-missing-dependency pending the SubShape/body-less resolution.
  Net geometry behavior unchanged for Body-bearing files (hole_puzzle still
  gaps on external-geometry-unresolved elsewhere).
- fcstd suite 13 files / 125 cases green.
