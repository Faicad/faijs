# Agent Note: `projectPointOnFace` on the neutral face

Status: implemented

English | [中文](2026-11-21-project-point-on-face.zh.md)

## Problem

A downstream library's `snap`/`dent` path needs the closest point **on a face**.
`BrepEngineApi` exposed `surfaceCenterOfMass` and `surfaceNormal`, but no
projection, so the library sampled the face centre instead. Large `dent` tools
were then placed at the wrong point on a lofted surface; the boolean emptied the
base and the next boolean failed with `getBoundingBox: shape has no geometry`.

## Decision

Add `BrepEngineApi.projectPointOnFace(face, point): BrepVec3`.

- occt maps it directly to `OcctKernel.projectPointOnFace`.
- brepkit and smlib fail explicitly (occt-only); the mock returns the input point.
- Downstream code uses the returned point for the distance and keeps the face
  centre only for the normal (occt's public projection returns no UV).

## Alternatives considered

**Keep the face-centre approximation.** It is not a nearest point; the caller's
tool placement and any later boolean inherit the error. Rejected.

**Reach into the occt kernel from the downstream library.** Violates the
one-adapter rule and breaks the neutral face. Rejected.

**Return `{point, uv}` instead of a point.** No engine exposes the projected UV
in its public API; adding a fabricated UV would be worse than the documented
centre-normal approximation. Rejected.

## Consequences

- `snap` now returns a real surface point on occt; its normal still comes from
  the face centre.
- `projectPointOnFace` is occt-only. A brepkit host fails explicitly instead of
  silently returning a centre point.
- The mock returns the queried point (bbox-only tests keep working).
- `packages/core/test/brep/project-point-on-face.test.ts` pins the projection
  onto a box face.