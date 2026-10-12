# Agent Note: selectors-to-refs bridge + selector-string op integration + teaching-channel lockdown

Status: implemented

English | [中文](2026-10-12-selectors-to-refs-bridge-op-integration.zh.md)

## Problem

CadQuery selector strings are the portable way for AI-generated scripts to pick
topology, but zero ops consumed them: the selector engine evaluated to kernel
handles, while fillet/chamfer/shell/draft/defeature/extrude/punchHole/sketch*
resolve `EdgeTopoRef`/`FaceTopoRef` (origin+role+hint). Meanwhile every teaching
channel (ai-gateway partials, ops-api-inventory, edgeRef/faceRef JSDoc) still
taught ordinal references (`cad.edgeRef(part, 1)`), the #1 source of
kernel-drift bugs across occt/brepkit.

## Decision

- **Bridge** `api/selectors-to-refs.ts`: `resolveSelectorToFaceRefs` /
  `resolveSelectorToEdgeRefs` / `resolveSelectorToVertexPts` translate a CadQuery
  selector string → kernel handles (via `resolveStepHandles`) → `TopoRef`s,
  reusing the existing handle→TopoRef reverse path (`captureFaceHint` /
  `captureEdgeHint` / `findOriginRole` / `recoverEdgeFaceRole`). Unnamed entities
  (no role lineage, e.g. mesh-chain solids) throw `TopoRefError` — no silent
  downgrade (R1). Selector subsystem and naming/TopoRef stay physically separate;
  the bridge is the only explicit channel between them.
- **Param input normalization** `expandEdgeSelectorRefs` /
  `expandFaceSelectorRefs` accept a top-level selector string or string array
  elements mixed with refs (D2-A): `edges: "|Z"`, `edges: ["|Z"]`,
  `edges: ["|Z", refA]`.
- **Op integration** (BREP/precision chain): fillet/chamfer (`edges`),
  filletVariable (`edge`, single edge — 0/multi match throws), shell
  (`openFaces`), draft/defeature (`faces`), extrude (`upTo`, resolved on
  `baseFeature`), sketchOnFace/sketchOnSurface/punchHole (`face`, resolved on the
  target solid via `resolveFaceHandle`). The mesh chain has no role layer:
  selector strings on it fail loudly with `E_TOPO_MESH_UNSUPPORTED` (mesh keeps
  1-based ordinals — design invariant). Single-entity parameters throw with the
  match count when a selector matches several (R3).
- **Teaching-channel lockdown (Q1)**: ops-api-inventory + gen-skill-docs examples
  switched to TopoRef literals / selector strings; edgeRef/faceRef JSDoc marked
  "query only, not for script generation"; SKILL.md gained a "Selector Strings"
  section; ai-gateway loader and sync-faijs-partials guard rejects any partial
  containing `cad.edgeRef(` / `cad.faceRef(` teaching (assertNoOrdinalTeaching).
  `fai_drill` untouched (its `face` param is a `FaceTopoRef`, out of scope).

## Verification

- `selectors-to-refs.test.ts` 6/6 green (identity: `">Z"` ref == naming-layer
  faceRef of the top face; unnamed input throws).
- `feature-family.test.ts` 32/32 green, including 8 new P2 anchors: fillet /
  chamfer `edges:"|Z"`, filletVariable multi-match throws, draft `faces:">X"` ==
  a faceRef face, defeature invalid selector fails, extrude `upTo:">Z"` on
  baseFeature reaches the top face (volume matches the faceRef branch), sketchOnFace /
  punchHole `face:">Z"`.
- core `tsc --noEmit` clean. Full core vitest: 3339 pass / 5 fail — the 5 are
  pre-existing brepkit-kernel (fillet/drill volume + STL fillet throw) and sweep
  open-wire assertions, reproduced on an isolated run, unrelated to this change.
- ai-gateway 70 tests green after the partial sync (guard cases included).

## Alternatives considered

- **Delete cad.edgeRef/cad.faceRef.** Rejected: they are the FCStd-import and
  mesh-chain ordinal bridge; legal consumers need them (design principle: Q1 is
  "seal the generation channels", not "remove the API").
- **Auto-pick the first match for single-entity params.** Rejected (R3): silently
  choosing is worse than failing when a selector matches several faces/edges.

## Consequences

- `FaceSelector` is now `number | FaceTopoRef | string`; `ExtrudeUpTo` gained the
  string form alongside `'last'/'first'` (resolved on `baseFeature`).
- The bridge file is the documented place for future selector-consuming ops.
- weapp probe gains selector-string cases after the 0.33.2 version linkage
  (bundle rebuild), per plan P4.
