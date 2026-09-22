# Agent Note: non-whitelisted types with a Shape asset → shape-asset import

Status: implemented

English | [中文](2026-09-20-shape-asset-any-type.zh.md)

## Problem

ArchDetail gapped with `compound-missing-members`: its compounds reference
Draft wires (`Part::Part2DObjectPython`) that carry REAL `Shape` `.brp`
members. The H7 shape-asset path covered only `Part::Feature` (and the
SubShape result caches); other non-whitelisted types fell through to
`type-not-whitelisted` even when their geometry existed as an asset.

## Decision

- In the non-whitelisted branch of `translateObject`, a `shapeCarriers` hit
  (Shape or SubShape `.brp` member exists) now resolves to
  `cad.import_shape` + `shape-asset` — the "geometry is an existing fact"
  rationale extended from Part::Feature to ANY non-whitelisted type.
- Whitelisted types are deliberately unaffected: Box/Pad/etc. keep the
  parametric translation path (test locks the non-hijack).
- Same-pass triage of the other two singles, both documented NOT fixed:
  - **Drilling_1 `unsupported-constraint`**: constraint Type=15 is
    InternalAlignment (ellipse pole alignment, InternalAlignmentType 1–4
    against an ellipse/arc host). Supporting it is feature work in the
    planegcs backend; dropping the constraint would change the sketch's
    semantics.
  - **TestSketchCarbonCopyReverseMapping `delta-exceeds-t1`**: carbon-copy
    external mapping tolerance; real solver/verify work, unchanged.

## Alternatives considered

- **Add `Part::Part2DObjectPython` to a whitelist** — rejected: it is a
  Python type with arbitrary semantics; what we actually consume is the
  frozen Shape asset, so the asset path (not a type lie) is the honest
  classification.
- **Support InternalAlignment (Type=15)** — deferred: needs ellipse/arc
  pole handling in planegcs-backend; single corpus file.

## Consequences

- 56-sample sweep: ok 46→**47** (ArchDetail converts), gap 10→9,
  checkFail 0. Remaining first causes: sketch-not-solved 2 (BIM policy /
  tangent topology), external-geometry 2 (curve projection / migrated
  format), singletons 5 (EngineBlock extrusion base, all_objects Draft
  types, Drilling_1 InternalAlignment, CarbonCopy delta, TestTangentMode).
- fcstd suite 13 files / 138 cases green (+1 GOTCHA test: non-whitelisted
  shape-asset + whitelisted non-hijack lock).
