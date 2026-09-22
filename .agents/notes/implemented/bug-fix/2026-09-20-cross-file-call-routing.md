# Agent Note: cross-file call routing — calls touching main/foreign-Body vars must live in main

Status: implemented

English | [中文](2026-09-20-cross-file-call-routing.zh.md)

## Problem

Wiring Body-container dependencies (test_geomop: Part::Cut with Tool→Body,
Base→loose Part::Box) exposed a SEC_FREE_IDENT class in the M10.3 multi-file
split: a Cut whose inputs live in OTHER modules was still emitted into its
own Body file (`let part26 = cad.subtract(part19, part5)` inside
Body003.fai.js while part19 was declared in main.fai.js). Three hidden
trap layers, each masked by the previous fix passing the suite:

1. A dependency on a Body container resolved against `variables`, which
   never holds a Body name (Body results live in chainVar).
2. Even with the chainVar fallback, Kahn treated the container dep as
   satisfied BEFORE the chain existed (Cut ran before its Base was built).
3. The file router compared `own === b` (always true when own is set) and
   skipped fold calls entirely (`own === undefined`), so cuts referencing
   main variables or foreign chain heads sailed through into Body files.

## Decision

- Dependency resolution: `variables.get(dep) ?? chainVar.get(dep)`.
- Kahn readiness: a Body-container dep expands to the Body's member
  features — the consumer is ordered AFTER the chain is built.
- Routing: a call goes to a Body file only if own === b, no input belongs to
  a different Body (`assigned` OR `headToBody` — foreign chain heads are
  never in `assigned`), and no input is an already-known main output
  (`mainOuts`; fold calls are not in `results`, so this check must not
  depend on `own`). Everything else goes to main, where inputs remap to the
  foreign Body's imported `<Body>_out` terminal alias.

## Alternatives considered

- **Import raw variables cross-file** — rejected: module exports are the
  `<Body>_out` terminals by contract (module-registry D6); exporting
  internal partN vars would break the naming stability the aggregate entry
  relies on.
- **Emit a local alias in the Body file instead** — rejected: a Body file
  importing another Body's terminal to feed its own chain hides the
  cross-Body dependency from the module graph; main is the honest place.

## Consequences

- 56-sample sweep: ok 45→**46** (test_geomop converts), gap 11→10,
  **checkFail 4→0** (the SEC_FREE_IDENT regressions introduced during this
  phase's own iteration are gone: 3 intermediate states had checkFail 4).
- Remaining 10 failures all genuine feature/geometry work (Draft objects,
  EngineBlock, external geometry, compound members, one unsupported
  constraint, delta-exceeds-t1).
- fcstd suite 13 files / 134 cases green (+1: Body-container chain-head
  resolution GOTCHA).
- Debug probe retained: `packages/core/scripts/dbg-cut-tool-body.mts`
  (tsx-run synthetic repro of the Tool→Body resolution).
