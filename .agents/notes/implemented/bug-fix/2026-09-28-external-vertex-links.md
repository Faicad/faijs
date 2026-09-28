# Agent Note: external `VertexN` links and source-ordered external geoIds

Status: implemented

English | [中文](2026-09-28-external-vertex-links.zh.md)

## Problem

Two defects in the same channel — the projection of a sketch's
`ExternalGeometry` links into the solver's fixed external geometry.

**1. Only `Edge<N>` links were resolved.** `resolveExternalGeometry`
(`packages/fcstd/src/external-geo.ts`) matched `sub.startsWith('Edge')` and
rejected anything else with `unsupported sub-element`. FreeCAD also links
external *vertices*: `door-keeper.FCStd` Sketch002 → `Sketch001.Vertex1`,
`CrankShaft.FCStd` Sketch003 → `Pad002.Vertex12`, `Fountain.FCStd` Sketch007 →
`Revolution005.Vertex19`. A single such link failed the whole sketch as
`L2 / external-geometry-unresolved`, which then cascaded into
`pad-missing-profile` / `groove-profile-baked-upstream` / `fillet-missing-base`
for every consumer of that sketch. 16 of the first 904 corpus files carried it.

**2. The solver geoId was derived from the filtered index.**
`convert.ts` computed `geoId: -3 - i` over the *successfully resolved* subset
(`usable.map((l, i) => …)`). FreeCAD fixes the slot as `-3 - linkIndex` in the
SOURCE link list and keeps it even when an earlier link fails to resolve, so any
failure shifted every later link one slot earlier. The shifted refs then pointed
at an external geoId that did not exist, and the backend's `unresolvableExternal`
check dropped those constraints — silently, with no failure record anywhere.

Both are silent-wrong-geometry bugs rather than crashes: the sketch still
"solved", just not to FreeCAD's geometry.

## Decision

Resolve `VertexN` links the same way `EdgeN` links are resolved, and carry the
SOURCE link index through to the caller instead of recomputing it from the
filtered position.

- `ExternalLink` gains `linkIndex` — documented as the index in the sketch's
  `ExternalGeometry` list, which is what `-3 - linkIndex` must use.
- A `VertexN` link is read with `getSubShapes(shape, 'vertex')[ord - 1]` +
  `vertexPosition` and projected to a ONE-point polyline. Ordinals are 1-based,
  matching the already-verified `Edge13 → edgeGroups[12]` convention.
- `convert.ts` accepts `polyline.length >= 1` (a vertex is a usable fixed
  target) and maps `geoId: -3 - l.linkIndex`.

The backend needed one change: `pt()` resolved external refs only through its
`externalLines` map (2-point edges). The primitive loop already pins every
sampled point as `P(geoId, i + 1)` — which is exactly what a `{geoId, pos}` ref
addresses — so the fix is to consult a per-geoId point count instead of the
line map. That covers 2-point edges, `VertexN` points and multi-point samples
with one rule.

The source `.brp` stores shape coordinates in the DOCUMENT frame, not the source
object's local frame, so the sketch's own inverse Placement remains the whole
transform. Verified by probe on `door-keeper.FCStd`: `Sketch001`'s Placement is
`(0, 110, 0)` and its `.brp` vertices sit at `y = 110`. Composing the source
object's Placement again would be wrong.

## Consequences

- The class is gone, and the fix is self-verifying because `classifySketch`
  only awards `L0` when the re-solve reproduces FreeCAD's stored coordinates —
  a wrong vertex ordinal or a shifted geoId cannot pass it.
  - `door-keeper.FCStd` → `ok: true, gaps: []`, 3/3 sketches `L0`
    (previously `ok: false` with `external-geometry-unresolved` as its only gap).
  - `CrankShaft.FCStd` → `ok: true, gaps: []`, 6/6 `L0`.
  - `Fountain.FCStd` → 10/10 sketches `L0` (was 9 L0 + 1 L2); its remaining gap
    is `fillet-non-edge-sub`, a different class.
  - `FCBL_table_parametric.FCStd` → 2/2 `L0`; remaining gap is
    `shape-asset-broken`.
- `CrankShaft.FCStd` now prints planegcs's `Redundant solving: 1 redundants`
  diagnostic on **stdout**. It is a correct consequence — the external-vertex
  constraint is now actually fed to the solver — and stdout is not stderr, so
  the tests' zero-tolerance rule is unaffected. The batch driver parses the last
  non-empty stdout line, which the diagnostic does not displace.
- Not implemented, deliberately: the projected vertex pins a point but the
  canonical model has no matching constraint kind, so this only affects the
  convert-time fidelity precheck and the runtime solve — the emitted
  `cad.sketch` still re-solves from the same projected constraints.

## Probe finding worth remembering

While building the regression fixture, a solve kept returning `Failed` and the
first explanation ("constraints onto a fixed point cannot move it") turned out
to be wrong. Measured matrix:

- `Coincident(free line end) ↔ external EDGE endpoint` moving (10,25)→(10,20):
  **converges**. So movement onto a fixed external point works.
- The same call on a line starting exactly at `(0,0)`: **fails**, and it fails
  identically with a fixed *non-external* point, with a root-point ref, and in a
  hand-built `GcsWrapper` setup — so it is not about external geometry at all.
- A fully-constrained rectangle at the origin converges, and so does the same
  one-line system translated to `(1,1)`.

Reading: an under-constrained free point sitting exactly on the implicit root
point `(0,0)` makes planegcs's Levenberg-Marquardt return `Failed` (rank-deficient
Jacobian at that configuration). It is a numerical degeneracy of tiny
under-constrained systems; the regression fixture therefore starts at `(5,5)`
and the reason is recorded in the test comment. Deliberately NOT encoded as an
assertion — it would lock in a solver quirk, and a planegcs upgrade could fix it.

## Files

- `packages/fcstd/src/external-geo.ts` — `linkIndex` on `ExternalLink`, shape /
  wireframe / vertex caches, the `VertexN` branch, the document-frame note.
- `packages/fcstd/src/convert.ts` — `>= 1` polyline filter and
  `geoId: -3 - l.linkIndex`.
- `packages/sketch/src/planegcs-backend.ts` — `externalPointCount` in the
  constraint context and the external branch of `pt()`.
- `packages/fcstd/src/external-geo.test.ts` — synthetic-archive tests: a
  `VertexN` resolves to one point, ordinals are 1-based, `linkIndex` keeps
  SOURCE order when an earlier link fails, an out-of-range ordinal is ledgered.
- `packages/fcstd/src/sketch-solver.test.ts` — a `Coincident` onto an external
  vertex actually moves the geometry onto it.
- `packages/fcstd/src/external-vertex-e2e.test.ts` — corpus-dependent end-to-end
  (skips when the sibling FreeCAD checkout is absent).

## Alternatives considered

- **Reject `VertexN` links as an honest gap.** Rejected: the kernel already
  exposes `getSubShapes(shape, 'vertex')` and `vertexPosition`, so the
  information is available; refusing it only pushes a fixable gap downstream.
- **Compose the source object's Placement with the sketch's.** Rejected by
  measurement, not by argument: the `.brp` coordinates already carry it (see
  above), so composing would apply it twice.
- **Keep `geoId: -3 - i` and drop failed links from the list.** Rejected: it
  makes the alignment depend on which links happen to resolve, so a document
  behaves differently once an unrelated link is fixed.
