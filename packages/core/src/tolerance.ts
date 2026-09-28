/**
 * tolerance.ts — dimensioned threshold / tolerance constants (D6).
 *
 * These are the magnitude thresholds that were previously bare magic numbers
 * with an implicit "mm" assumption. Each is defined once with an explicit unit,
 * then consumed via `.as(mm)` where a bare float must cross into a numeric
 * kernel (manifold-3d / occt-wasm). This keeps the mm basis readable without
 * hiding it in the runtime value.
 *
 * Not all §2.2 thresholds collapse into one constant — they are not one kind of
 * thing:
 *  - `CENTROID_DIST_SQ_MAX_MM2` is a SQUARED magnitude (mm²), so it stays a bare
 *    number with the unit spelled out in its name (D6 hard constraint 1).
 *  - `angularDeflection`'s default 0.5 is in radians and is intentionally NOT
 *    part of the length tolerance family (D6 hard constraint 2).
 */
import { mm, type ValueWithUnits } from './units'

/** Zero-length gate: a length at or below this is treated as zero. Independent of OCCT's tolerance. */
export const ZERO_LENGTH: ValueWithUnits = mm.mul(0.1e-9)

/** Mesh → STEP sewing tolerance (occtKernel.ts `meshesToStep`). */
export const SEWING_TOLERANCE: ValueWithUnits = mm.mul(0.01)

/** Default chord-error (linear deflection) for tessellation (multiple op sites). */
export const DEFAULT_LINEAR_DEFLECTION: ValueWithUnits = mm.mul(0.1)

/** Fallback bounding box half-extent when a shape has no real bounds (topologyExt). */
export const OCTREE_BBOX_FALLBACK: ValueWithUnits = mm.mul(100)

/**
 * Centroid-distance² upper bound used by topology naming (mm²). This is a
 * SQUARED magnitude — it must stay a bare number; writing `(10*mm)^2` would
 * drop the dimension and fail for non-length dimensions (D6 hard constraint 1).
 */
export const CENTROID_DIST_SQ_MAX_MM2 = 100

/**
 * Convenience: extract a tolerance's base-unit float (mm) for numeric kernels.
 * @param v - a dimensioned tolerance value.
 * @returns the magnitude in mm (base-unit float).
 */
export function asMm(v: ValueWithUnits): number {
  return v.as(mm)
}