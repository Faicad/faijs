# Agent Note: `Part::Compound` members that carry no geometry

Status: implemented

English | [中文](2026-09-28-compound-nonmodeling-members.zh.md)

## Problem

`Part::Compound` translation (`packages/fcstd/src/feature-translate.ts`) read
the object's `Links` `PropertyLinkList` and required **every** link to resolve a
geometry variable. Any link that did not made the whole object bake as
`compound-missing-members`, which gapped the entire document (exit 2, no
`.fai.zip` written).

FreeCAD's semantics are narrower: `Part::Compound` accepts any document object
in `Links` and simply ignores the ones without a Shape. The FCBL furniture
family (`FCBL_curtain`, `FCBL_bed_double`, `FCBL_nightstand_wall_hung`) puts the
document's `App::VarSet` FIRST in that list — the parameter container the
Extrudes read their `<<Label>>.Alias` expressions from. Every Extrusion member
resolved; the `VarSet` never could, because `codegen.ts` short-circuits
non-modeling types to `preserved-only` before translation and therefore never
creates a variable for it.

19 of the 28 corpus files carrying the class had this shape.

## Decision

Skip members whose **type** is non-modeling when computing the compound's member
list, then keep the existing requirement that at least one member resolves.

The predicate is `isNonModelingType` from `structural-types.ts` — the same one
`codegen.ts` uses to short-circuit such objects before translation and
`convert.ts` uses for the C4 audit, so a member can never be dropped in the
translator yet emitted as a modeling feature elsewhere.

The skip is deliberately conservative in one direction: a member that is absent
from `docObjects` (the translator is called with two arguments, as the unit
tests do) stays REQUIRED. Dropping on ignorance would silently emit a compound
of the wrong members, so a link's type must be known before it can be skipped.

## Measured effect

- `FCBL_curtain` / `FCBL_bed_double` / `FCBL_nightstand_wall_hung` → `ok: true`,
  `gaps: []`; the emitted `cad.compound` members equal the Extrusion links
  (1 / 5 / 6) with no trace of the `VarSet`.
- Re-measuring all 28 corpus files that carried the class: **19 now convert
  `ok`**, including `Bathroom_cabinet_sink.FCStd` (63 sketches) and
  `Bedroom_closet.FCStd` (56).
- 13 still gap with a DIFFERENT sub-cause: an empty `Links` list while the
  object carries a real baked `Shape` `.brp` (e.g. `arduino-mega.fcstd`). Not
  addressed here.

## Alternatives considered

- **Translate non-modeling members as empty calls.** Rejected: `cad.compound`
  requires every member to be on the BREP chain and throws
  `E_BREP_UNSUPPORTED` otherwise, and a `VarSet` has no geometry to contribute.
- **Drop every link that fails to resolve.** Rejected: it cannot distinguish
  "carries no geometry" from "geometry failed to translate", so a cascade would
  silently produce a compound of the wrong members.
- **Hard-code the `App::VarSet` type.** Rejected: the same Links list can hold
  `Spreadsheet::Sheet`, `App::Plane` or a group, and the shared non-modeling
  predicate already covers the family and cannot drift from codegen's view.

## Consequences

- The class is gone for the non-modeling-member shape, and the fix is
  self-verifying: the `VarSet` produces no codegen variable, so a member list
  that still required it could never reach the expected shape.
- A corpus-dependent e2e (`compound-members-e2e.test.ts`) pins conversion plus
  the emitted member count on the three FCBL documents.
- Discovered while verifying: these products do NOT execute. The canonical
  sketch projection drops the `construction` flag and `toFreeCadGeoms` rejects
  `point` / `ellipse` / `bspline` while `fromFreeCadGeoms` produces them — so an
  emitted `cad.sketch` payload is either rejected at run time or silently
  promotes construction geometry into the profile. Separate defect, fixed on its
  own.

## Files

- `packages/fcstd/src/feature-translate.ts` — the `Part::Compound` branch.
- `packages/fcstd/src/feature-type.test.ts` — four unit cases.
- `packages/fcstd/src/compound-members-e2e.test.ts` — corpus e2e.
