# Agent Note: `draft` and `reverseShape` are narrowed to occt-only by empirical evidence

Status: implemented

English | [中文](2026-09-24-occt-only-empirical-narrowing.zh.md)

## Problem

Two hand-written ops reached the script face declaring only the family-level capability
`capabilities: ['directEdit']`:

- `cad.draft` — draft angle on selected faces;
- `cad.reverseShape` — reverse shell orientation.

Both engines declare `directEdit: true` as a family-level boolean, so the static capability gate
admitted these ops on **both** engines. On brepkit the failure surfaced after dispatch, in two
different shapes — neither of them acceptable:

- `reverseShape` fails at the op level: `invalid solid handle: index N is out of bounds`
  (the reported callee is `reverseShape`, not an input-construction op).
- `draft` returns geometry that is wrong in a way that does not throw. Measured on the same
  script (`cad.box(20,20,10)`, `angleDeg: 3`, one face selected by `cad.faceRef`), in a single
  process, with faces enumerated by geometry so that ordinal mismatches cannot be blamed:

  | engine | ordinals 1–6 (= face list order) | result |
  |---|---|---|
  | occt | `[-X, +X, -Y, +Y, -Z, +Z]` | ordinals 1–4 (the four sides) all give **exactly** `−52.4078`; the two caps (⊥ to pull) are rejected by the kernel |
  | brepkit | `[-Z, +Z, -Y, +Y, -X, +X]` | `+60.29 / 0 / 0 / +17.47 / 0` |

  Three facts make this conclusive rather than an ordinal artefact:
  1. A symmetric body drafted on one side face must give the same result for all four sides.
     occt does; brepkit returns four different values. Symmetry breakage is independent of
     which ordinal maps to which face.
  2. Three ordinals are **silent no-ops** — volume and bounding box both unchanged. The project
     rule for this situation is to refuse rather than silently emit wrong geometry.
  3. The cap (perpendicular to pull) grows the x/y bounding box by `0.524 = 10·tan 3°`, i.e. a
     taper is being applied to a face it cannot apply to.

Both shapes violate the dispatch rule: BREP-chain availability must be decided statically,
before execution. "Gate says yes, kernel says no" is exactly the state that rule forbids, and
nothing at runtime can repair a failed static judgement.

## Decision

`draft` and `reverseShape` declare `engines: ['occt']`.

- The narrowing is **per op**, not per family. `fillet` is correct on brepkit (equal to occt to
  the last digit), `shell` produces a thin wall on both (bounding boxes identical), and
  `unifySameDomain` works on both (with a recentring difference). Only the two ops with
  evidence against them are narrowed.
- It is **empirical, not a dependency claim**: both files import no platform module and their
  implementations only touch the L1 contract surface. The engines axis is being used to say
  "this op cannot produce correct geometry here", which is what the axis is for.
- The `capabilities` list is kept alongside `engines`. The two axes are independent and are
  evaluated in order (engine whitelist first, capability intersection second); this declaration
  is only possible because that exclusion was removed.
- No per-kernel capability names are invented. Growing `BrepMethodKind` with `draft` /
  `reverseShape` and declaring them in the occt method list would enlarge a vocabulary to
  express something a different axis already expresses.

## Alternatives considered

- **Add per-kernel capability names (`capabilities: ['draft']`) and let the capability gate
  reject brepkit.** Rejected as the wrong axis and the larger change: it requires extending the
  method union plus both engines' method tables, and it states a kernel-method dependency where
  the actual fact is "not supported by this engine".
- **Narrow the whole repair/edit family to occt.** Rejected: the family is not uniformly broken.
  `fillet` and `shell` are demonstrably fine on brepkit; a family-wide declaration would discard
  working functionality to hide two defects.
- **Keep the declarations and document the defects.** Rejected: it leaves the red-line shape in
  place — an op that passes the static gate and then throws, or silently returns wrong geometry,
  under brepkit.
- **Fix brepkit's L1 `draft` / `reverseShape` instead.** Not attempted here: that is kernel-side
  work with no evidence yet about the cause, and the static gate is needed regardless of when the
  kernel is fixed. Narrowing now does not block a later widening.

## Consequences

- On brepkit both ops now fail **before execution**, with the engine named in the message. The
  former behaviour — deep kernel error, or wrong geometry returned silently — is gone.
- Occt behaviour is unchanged. `draft`'s parametrised validation (non-zero angle, face
  references, `neutral.normal`) is unaffected.
- `draft`'s `neutral` parameter is de facto reduced to its default: occt-wasm's native
  `draft(shape, face, angleRad, direction)` has no neutral argument and the adapter rejects a
  non-origin point rather than dropping it, while brepkit — the only engine that consumed the
  neutral point — is now rejected statically. A non-origin neutral point therefore has no
  remaining engine and says so explicitly instead of silently mis-drafting. Whether to implement
  the semantics or drop the parameter is a separate open question.
- Four ops were left unchanged for lack of clean evidence, and this is recorded rather than
  guessed: `defeature`, `sew`, `sewAndSolidify`, `removeHolesFromFace`. Their probe inputs hit
  input-construction limits (face references) before reaching op-level behaviour, so no engine
  declaration was added for them.
- Regression guards live in `api/feature-family.test.ts`: under brepkit both ops must report an
  execution-prep failure naming `occt`; under the mock engine, the platform-identity gate must
  not intercept `draft`.
