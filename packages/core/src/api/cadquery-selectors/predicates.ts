/**
 * cadquery-selectors/predicates — per-entity boolean tests mirroring
 * cadquery/selectors.py (plan §4.4). These are the clean-room re-encoding of
 * the upstream selector classes, grounded by a probe of the LOCKED cadquery
 * 2.8.0 reference behavior.
 *
 * Two families:
 *   - **cluster-free tests** — direction / parallel / perpendicular / type;
 *     evaluated per candidate entity over the ordered set.
 *   - **cluster-based extraction** — minmax / center-nth / direction-nth;
 *     these sort candidates by center-projection on an axis and pick a cluster,
 *     mirroring `_NthSelector.cluster` + `filter` (implemented in resolve.ts).
 *
 * The base direction-motivated selectors apply ONLY to *linear edges* and
 * *planar faces*; every other entity is dropped (upstream `BaseDirSelector`
 * `continue`s for those, selectors.py:174-184).
 */
import type { EntityGeom, P3, ShapeHandle } from './entity'

/** Tolerance used by the direction selectors (upstream default 1e-4 rad). */
export const DIR_TOLERANCE = 1e-4

/** Tolerance used by the N-th clustering (upstream `_NthSelector.tolerance`). */
export const NTH_TOLERANCE = 0.0001

function unitDot(a: P3, b: P3): number {
  const al = Math.hypot(a.x, a.y, a.z) || 1
  const bl = Math.hypot(b.x, b.y, b.z) || 1
  return (a.x * b.x + a.y * b.y + a.z * b.z) / (al * bl)
}

/**
 * `ParallelDirSelector` semantics: the direction (normal/tangent) is parallel
 * to `axis` — the unit dot is ≈ ±1.
 *
 * @param dir - The candidate direction vector (face normal / edge tangent).
 * @param axis - The unit direction of the selector axis.
 * @param tolerance - Angular tolerance in radians (default `DIR_TOLERANCE`).
 * @returns `true` when `dir` is (anti)parallel to `axis`.
 */
export function isParallel(dir: P3, axis: P3, tolerance = DIR_TOLERANCE): boolean {
  return Math.abs(unitDot(dir, axis)) >= 1 - tolerance
}

/**
 * `PerpendicularDirSelector` semantics: angle between direction and axis ≈ π/2.
 *
 * @param dir - The candidate direction (face normal / edge tangent).
 * @param axis - The unit direction of the selector axis.
 * @param tolerance - Angular tolerance in radians (default `DIR_TOLERANCE`).
 * @returns `true` when `dir` is perpendicular to `axis`.
 */
export function isPerpendicular(dir: P3, axis: P3, tolerance = DIR_TOLERANCE): boolean {
  return Math.abs(unitDot(dir, axis)) <= tolerance
}

/**
 * `DirectionSelector` (`+`/`-`/bare) semantics: the direction is within
 * tolerance of the *signed* axis.
 *
 * @param dir - The candidate direction (face normal / edge tangent).
 * @param axis - The unit direction of the selector axis.
 * @param sign - `+1` to match the positive axis, `-1` for the negative axis.
 * @param tolerance - Angular tolerance in radians (default `DIR_TOLERANCE`).
 * @returns `true` when `dir` is aligned to `sign * axis`.
 */
export function isAligned(dir: P3, axis: P3, sign: number, tolerance = DIR_TOLERANCE): boolean {
  const d = unitDot(dir, axis)
  return sign >= 0 ? d >= 1 - tolerance : d <= -(1 - tolerance)
}

/**
 * Whether an entity is examined by a direction test (linear edges, planar faces).
 *
 * @param geom - The candidate entity geometry.
 * @returns `true` when the entity carries a meaningful direction (PLANE / LINE).
 */
export function isDirectionCandidate(geom: EntityGeom): boolean {
  switch (geom.kind) {
    case 'face':
      return geom.geomType() === 'PLANE'
    case 'edge':
      return geom.geomType() === 'LINE'
    case 'vertex':
      return false
  }
}

/**
 * `TypeSelector` semantics — match the upcased `geomType()` name.
 *
 * @param geom - The candidate entity geometry.
 * @param want - The upcased CadQuery geometry-type name to match (e.g. `PLANE`).
 * @returns `true` when the entity's `geomType()` equals `want`.
 */
export function typeMatches(geom: EntityGeom, want: string): boolean {
  return geom.geomType() === want
}

/**
 * Resolve the direction-bearing vector for an entity, or null when skipped.
 *
 * @param geom - The candidate entity geometry.
 * @param owner - Optional owning shape handle used to orient a face normal.
 * @returns The direction vector for a linear edge / planar face, else `null`.
 */
export function entityDirection(geom: EntityGeom, owner?: ShapeHandle): P3 | null {
  if (!isDirectionCandidate(geom)) return null
  return geom.direction(owner as ShapeHandle)
}