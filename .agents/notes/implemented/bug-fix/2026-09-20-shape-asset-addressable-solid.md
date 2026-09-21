# Agent Note: shape-asset features are addressable solids (import_shape)

Status: implemented

## Problem

After SubShape→shape-asset landed, hole_puzzle still gapped with
`fillet-missing-base` and test_geomop with `cut-missing-dependency`: the
shape-asset verdict emitted ZERO calls, and codegen registers variables
only from calls (or non-identity placements) — so a zero-call object had NO
variable and downstream consumers (Fillet with Base→Pocket, Cut with
Base→Pad) could not resolve their dependency. The dependency existed; the
variable binding was missing.

## Decision

- The shape-asset verdict now emits one `cad.import_shape` call
  (`params.asset` = the SubShape `.brp` member path, `source` = object
  name). The result cache becomes a real, addressable solid variable; the
  build-fai-zip assets/ delivery already carries the bytes.
- The placeholder `out` is the object name — codegen renames all outputs to
  partN anyway. (First attempt referenced `out` before its declaration —
  ReferenceError caught by the new test itself.)
- Old test assertion (`calls: []`) updated to the new contract with a
  comment marking the 2026-09-20 change.

## Alternatives considered

- **Register a variable in codegen for zero-call translated objects** —
  rejected: it would bind the name to nothing executable; an import_shape
  call is honest (the solid IS loaded from the asset) and keeps codegen's
  variable rule single-sourced (variables come from calls).
- **Resolve Fillet/Cut bases against the Body chain like Pocket** — not
  applicable here: these files have no Body; the base reference is explicit
  (Base→Pocket) and simply needed the target to be addressable.

## Consequences

- 56-sample sweep: ok 44→**45**, gap 12→11, checkFail 0. hole_puzzle
  advances past its fillet chain to `external-geometry-unresolved` (real
  external-geometry work); test_geomop's Cut chain resolved but still gaps
  on its own next blocker (cut-missing-dependency remains for a different
  unresolvable Base — triage next phase).
- fcstd suite 13 files / 133 cases green (2 new/updated GOTCHA tests).
- Remaining 11 failures: type-not-whitelisted 3 (draft_test_objects,
  EngineBlock, all_objects), sketch-not-solved 2 (policy/topology),
  external-geometry 2, compound 1, unsupported-constraint 1, cut 1,
  delta-exceeds-t1 1 — all genuine feature/geometry work.
