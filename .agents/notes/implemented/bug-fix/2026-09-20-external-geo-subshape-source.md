# Agent Note: external-geometry SubShape source fallback (shapeBrpFile)

Status: implemented

## Problem

hole_puzzle's external-geometry sketches all failed with
`external-geometry-unresolved: no links` — misleading, because the sketches
DO carry ExternalGeometry links (Chamfer002 Edge13, Pocket002 Edge44…).
`wireframeOf` looked up the source object's `.brp` member only via the
`Shape` property; PartDesign features (Chamfer/Pocket) store their result
cache in `SubShape` and have NO `Shape` property → every link failed with
"source shape not loadable" → `usable` empty → the verdict collapsed to the
"no links" catch-all.

## Decision

- New exported helper `shapeBrpFile(obj)`: `Shape` file when present, else
  `SubShape` file — same property pair the shapeCarriers collection already
  uses (single source of truth for "where does this object's shape live").
- `wireframeOf` uses the helper. Failure reasons now surface per-link
  instead of being masked by the catch-all.
- **External CURVE projection stays a documented gap**: Sketch011's Edge110
  resolves to a 630-point arc polyline and is dropped by the
  `polyline.length === 2` straight-line filter BY DESIGN (2-point segments
  only). Accepting polylines would silently substitute a tessellated arc
  for exact geometry. PartDesignExample's migrated `ExternalGeo` format
  (shadow geometry inline) is a separate format family — unchanged.
- Tests: new `external-geo.test.ts` (3 synthetic cases: Shape preferred,
  SubShape fallback GOTCHA, no-file undefined).

## Alternatives considered

- **Accept multi-point polylines as external segments** — rejected: the
  sketch channel consumes straight 2-point references; a 630-point arc would
  bloat the emitted sketch and freeze tessellation error into the model.
  Proper support = project the exact curve (arc/circle) into the sketch
  channel as its own segment kind — a feature, next-phase candidate.
- **Parse PartDesignExample's migrated ExternalGeo inline geometry** —
  deferred: different format (GeometryList + ExternalTypes + shadow
  attributes), no corpus pressure beyond this one file.

## Consequences

- hole_puzzle's straight-line external references (Sketch003/004/005/006)
  now resolve; the file still gaps on Sketch011 (arc external ref) — a
  real, correctly-reported capability gap now.
- 56-sample sweep: ok holds at 46, checkFail 0 (no net conversion change —
  this fix removes a masked failure class and sharpens reporting).
- fcstd suite 13 files / 137 cases green (+3).
