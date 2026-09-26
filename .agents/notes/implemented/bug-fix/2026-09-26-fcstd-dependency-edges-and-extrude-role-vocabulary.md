# Agent Note: FCStd B2 dependency edges and A2 extrusion role vocabulary

Status: implemented

English | [中文](2026-09-26-fcstd-dependency-edges-and-extrude-role-vocabulary.zh.md)

## Problem

Two separate blockers kept `Architectural Parts/Bedroom/Beds.FCStd` from producing a runnable
product. They were reported as two different plan items, and neither had the cause the plan
recorded.

**B2 — "Loft/Compound not implemented".** The converter reported

```
gaps: [{"name":"Loft002","type":"Part::Loft","reason":"loft-section-baked-upstream:Sketch262"},
       {"name":"Compound001","type":"Part::Compound","reason":"compound-missing-members"}]
```

but `Sketch262` was *translated and solved*, and `Compound001`'s `Links` were all present. Both
reasons were artifacts, not capability gaps.

**A2 — "fillet edgeRef has no role lineage".** The plan recorded this family (A2/A4/A6) as
resolved by the earlier topology-lineage rework. With B2 fixed, the run reached

```
Execution failed at statement 32 (callee: fillet): edgeRef: adjacent face ordinal 2 has no role lineage
```

so the claim was wrong for this sample: the failure is not a broken lineage walk but a missing
*vocabulary* on the fillet's base solid.

## Decision

### B2: derive the topological-sort edges from the translator's own property list

`codegen.ts depsOf()` carried its own hard-coded link property list. `Sections` (Part::Loft /
Part::Sweep profiles) and `Spine` (Part::Sweep path) were absent, and `Originals` sat in the
single-value list where a `App::PropertyLinkList` yields nothing. Kahn therefore placed the
feature at its Document.xml position — FreeCAD sorts that file by object name, so `Loft002`
precedes `Sketch262` — and `inputVar()` legitimately returned undefined.

Rather than adding the missing names to a second list, `feature-translate.ts` now exports
`LINK_INPUT_PROPS` and `LINK_LIST_INPUT_PROPS` — the properties the translator actually resolves
through `inputVar()` — and `depsOf()` consumes them. The two lists cannot drift again.

`UpToFace` is deliberately excluded: a Pad/Pocket "up to face" reference can point at geometry a
LATER feature produces, and honouring it would deadlock the sort.

The Kahn loop also gained a cycle break. It previously dropped stalled objects from `order`
entirely, so they never reached the translator and kept the container's initial
`feature-translation-pending` disposition — an ordering deadlock reported as a translation gap.
Adding dependency edges must not be able to make an object disappear from the ledger, so
remaining objects are now emitted in iteration order and degrade to their own honest bake reason.

### A2: extrude must name every side face, and must know which axis it extruded along

Measured on Beds `part28` (`place(extrude(sketch))`, profile with four arcs): 10 faces, only 6
covered by the role table (`bottom, top, wall:0..3`); the four uncovered faces (ordinals 2/4/6/8)
were exactly the four `cylinder` side faces the arcs sweep out. Two defects:

1. `extrudeConstructRoles` read a face normal only when `surfaceType === 'plane'`, so curved side
   faces had no normal, got no `wall:<i>`, and were skipped by `wallIdx` — which also broke the
   `role-name.ts` contract that `wall:3` is the face swept from profile edge 3.
2. The axis was "the first anti-parallel pair of planar normals". A rectangular prism has three
   such pairs; in Beds the X-facing side walls were found before the caps, so `top`/`bottom`
   landed on side walls and the real caps were numbered `wall:N`.

Fix: side faces are classified by normal regardless of surface type (a cylinder's uv-midpoint
normal is radial, hence perpendicular to the extrusion axis), and the axis is *hinted* by the
op's own extrusion direction and *confirmed* by geometry — at least two face normals must be
parallel to it before it is accepted, otherwise the original geometric search still runs. Both
halves are required: the direction disambiguates, the geometry arbitrates.

## Alternatives considered

- **Add the missing property names to `depsOf` in place.** Rejected: that is exactly how the list
  drifted twice already (documented GOTCHAs for `Links` and now `Sections`). A single exported
  source of truth is the fix; a fourth hand-copied name is not.
- **Make `depsOf` generic over every `App::PropertyLink*` property.** Rejected: `UpToFace` and
  attachment `Support` links can point downstream, and the resulting cycles would reorder (or,
  before the cycle break, drop) objects for no benefit.
- **Let `edgeRef` fall back to a lineage re-walk** (the fallback `resolveFaceGeometry` already
  has). Rejected as the A2 fix: it cannot help. The face is not a miss in a populated table — no
  role ever named it, so there is no `(origin, role)` to re-walk from. It remains a real
  asymmetry worth closing, but it is not this bug.
- **Give non-primitive chain roots positional fallback names** (`extrude:face_3`). Rejected and
  already outlawed: OCCT does not promise stable face ordering, so such names are replay-unsafe
  and would inflate coverage statistics with meaningless names.
- **Compute the extrusion axis purely geometrically but smarter** (e.g. pick the anti-parallel
  pair with the largest separation). Rejected: indirect and still ambiguous for near-cubic
  prisms. The op knows the direction it extruded along; refusing to use it because "the script
  might express it differently" is answerable — the geometry confirmation step answers it.

## Consequences

- Beds.FCStd: `gaps` 2 → 0 (`translated` 31 → 33), and `cliRun` reaches a STEP export (4930
  entities). Both plan items are closed on their sample file.
- The A2 fix changes role *assignment* for every extrusion, not just arc-containing ones: any
  prism where the caps were not the first anti-parallel pair now gets correct `top`/`bottom`
  instead of having them land on side walls. Downstream `faceRef`/`edgeRef` references that
  happened to encode the old (wrong) names will resolve differently — correctly, but differently.
- Regression guards: `packages/core/src/api/extrude-wall-role-gotcha.test.ts` (core) and two new
  cases in `packages/fcstd/src/codegen.test.ts` (translator).
- Probes kept per repo policy: `packages/core/scripts/probe-a2-edgeref.ts`,
  `probe-a2-beds.ts`, `packages/fcstd/scripts/probe-b2-beds.ts`, `probe-b2-xml.ts`,
  `sweep-gaps.ts`.
- Remaining on the corpus sample (119 files, no regression): honest bake reasons such as
  `sketch-solved-no-closed-loop`, `compound-missing-members` on genuinely unbuilt members,
  `sweep-spine-baked-upstream`, and `shape-asset-broken`. Zero objects were dropped by the sort
  (`feature-translation-pending` count is 0).
