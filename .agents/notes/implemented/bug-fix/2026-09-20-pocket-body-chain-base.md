# Agent Note: Pocket without BaseFeature resolves via the Body chain

Status: implemented

## Problem

FreeCAD 0.20+ PartDesign files routinely OMIT the `BaseFeature` property on
interior features — the base is implied by the Body's feature order. The
translator required `inputVar(BaseFeature)` to resolve, so every Pocket
without the property gapped as `pocket-missing-dependency` even though its
Profile sketch was translated and solved. Corpus: hole_puzzle (9 Pockets,
ALL without BaseFeature), motor_mount_inch (2), strange_part_with_holes (2)
— 3 files blocked purely by this.

## Decision

- `feature-translate.ts`: new exported marker `BODY_CHAIN_BASE`
  (`'::body-chain-base::'` — not a legal variable name). A Pocket with a
  MISSING BaseFeature property emits its `cad.subtract` with the marker as
  the base input; an EXPLICIT BaseFeature that fails to resolve is still a
  gap (locked by test).
- `codegen.ts`: when folding a feature into its Body chain, every call input
  equal to the marker is retargeted at the chain head (`prev`).

## Alternatives considered

- **Resolve the implicit base in the translator** — rejected: the translator
  has no Body-chain context (it is per-object); the chain head exists only in
  codegen's fold step.
- **Skip the subtract and let the fold step subtract `prev − featureVar`** —
  considered; equivalent, but emitting the subtract with a marker keeps the
  Pocket's own call list self-describing and works for the UpToFace/UpToFirst
  paths too once they learn the marker.

## Consequences

- 56-sample sweep: the 3 pocket-missing-dependency files advanced to the
  NEXT real blocker: `pocket-type-ThroughAll-unsupported` (their Pockets are
  ThroughAll) — ok stays 37 this round, but the dependency-chain failure
  class is gone; ThroughAll support is the follow-up.
- Tests: 2 new cases in `feature-translate.test.ts` (marker emission +
  explicit-base-still-gaps). fcstd suite 13 files / 125 cases green.
