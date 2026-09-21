# Agent Note: SubShape result caches → shape-asset (Body-less PartDesign files)

Status: implemented

## Problem

After the Body-chain fix and ThroughAll support, the 3 Body-less CAM demo
files (hole_puzzle, motor_mount_inch, strange_part_with_holes) still gapped
with `pocket-missing-dependency`: they have NO PartDesign::Body, so the
BODY_CHAIN_BASE marker had no chain head to resolve to. Corpus probe showed
each Pocket carries a `SubShape` property (Part::PropertyPartShape) whose
`.brp` member exists in the ZIP — the pocketed geometry is already a fact
(hole_puzzle: 9 SubShape caches / 77 .brp members; the other two: 2 each).
An honest-but-useless gap for geometry that already exists as an asset.

## Decision

- `translateObject`: when the object is in the `shapeCarriers` set AND has a
  `SubShape` property, resolve to `{ kind: 'translated', calls: [], reason:
  'shape-asset' }` — reuses the H7 Part::Feature pattern (result cache →
  zero cad calls, geometry via assets/).
- **Only SubShape qualifies as evidence.** Pads in the same files also carry
  a `Shape` property; hijacking them into shape-asset would suppress real
  translation (locked by test: a Pad with Shape stays on the normal path).
- `convert.ts` collects SubShape carriers into the same `shapeCarriers` set
  (a SubShape property whose `file` member exists).
- Sweep-regression triage in the same pass: `Part::Plane`, `Part::Line`
  (Part workbench datum plane/line — same semantics as App::Plane/App::Line),
  `App::TextDocument`, and `Fem::FemPostWarpVectorFilter` joined the
  structural/FEM sets — they surfaced as soon as earlier blockers fell.

## Alternatives considered

- **Treat Shape presence on features as shape-asset too** — rejected: a
  feature's Shape is its computed result; a translatable feature must keep
  translating so parameter changes flow. Only the feature-owned `SubShape`
  cache marks "this object's whole purpose is this frozen result" in
  Body-less files.
- **Synthesize a virtual Body chain for these files** — rejected: the files
  genuinely have no Body; inventing one changes geometry ordering semantics
  beyond the evidence.

## Consequences

- 56-sample sweep: ok 37→**39** (strange_part_with_holes, FEMExample join;
  motor_mount_inch fully converts; hole_puzzle advances to
  fillet-missing-base — its own next blocker), checkFail 0.
- Remaining first causes: type-not-whitelisted 6 (Draft/Assembly/VRML —
  batch phase), sketch-not-solved 4, five singles incl. hole_puzzle's
  fillet chain.
- fcstd suite 13 files / 128 cases green (3 new: SubShape asset, Pad
  non-hijack GOTCHA, evidence-absent path).
