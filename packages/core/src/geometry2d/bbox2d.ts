/**
 * Axis-aligned 2D bounding box (pure-data; faijs port of brepjs `BoundingBox2d`).
 * brepjs backs this with a kernel `Bnd_Box2d`; here it's plain numbers.
 *
 * License: adapted from brepjs (Apache-2.0).
 * @module
 */

export interface BBox2d {
  xMin: number
  yMin: number
  xMax: number
  yMax: number
}

/**
 * Create an empty (inverted) bounding box.
 * @returns a fresh BBox2d whose mins are +Infinity and maxes are -Infinity.
 */
export function createBBox2d(): BBox2d {
  return { xMin: Infinity, yMin: Infinity, xMax: -Infinity, yMax: -Infinity }
}

/**
 * True when the box holds no finite extent yet.
 * @param bb - the bounding box to test.
 * @returns true when any corner is non-finite or the box is inverted.
 */
export function isEmpty(bb: BBox2d): boolean {
  return (
    !isFinite(bb.xMin) || !isFinite(bb.yMin) || !isFinite(bb.xMax) || !isFinite(bb.yMax) ||
    bb.xMax < bb.xMin || bb.yMax < bb.yMin
  )
}

/**
 * Expand `bb` to include the given corner points.
 * @param bb - the bounding box to expand in place.
 * @param pts - the corner points to include.
 */
export function addPoints(bb: BBox2d, pts: ReadonlyArray<readonly [number, number]>): void {
  for (const [x, y] of pts) {
    if (x < bb.xMin) bb.xMin = x
    if (y < bb.yMin) bb.yMin = y
    if (x > bb.xMax) bb.xMax = x
    if (y > bb.yMax) bb.yMax = y
  }
}

/**
 * Expand `bb` to include all points of `other`.
 * @param bb - the box to expand in place.
 * @param other - the box whose extent is folded into `bb`.
 */
export function mergeBBox(bb: BBox2d, other: BBox2d): void {
  if (other.xMin < bb.xMin) bb.xMin = other.xMin
  if (other.yMin < bb.yMin) bb.yMin = other.yMin
  if (other.xMax > bb.xMax) bb.xMax = other.xMax
  if (other.yMax > bb.yMax) bb.yMax = other.yMax
}

/**
 * Return `[min, max]` corner points.
 * @param bb - the bounding box to read from.
 * @returns the lower-left and upper-right corners as `[[xMin,yMin],[xMax,yMax]]`.
 */
export function boundsOf(bb: BBox2d): [[number, number], [number, number]] {
  return [
    [bb.xMin, bb.yMin],
    [bb.xMax, bb.yMax],
  ]
}

/**
 * Compute the center point of the box.
 * @param bb - the bounding box to read from.
 * @returns the midpoint `[x, y]` between the min and max corners.
 */
export function centerOf(bb: BBox2d): [number, number] {
  return [(bb.xMin + bb.xMax) / 2, (bb.yMin + bb.yMax) / 2]
}

/**
 * Compute the width of the box.
 * @param bb - the bounding box to read from.
 * @returns the absolute horizontal extent.
 */
export function widthOf(bb: BBox2d): number {
  return Math.abs(bb.xMax - bb.xMin)
}

/**
 * Compute the height of the box.
 * @param bb - the bounding box to read from.
 * @returns the absolute vertical extent.
 */
export function heightOf(bb: BBox2d): number {
  return Math.abs(bb.yMax - bb.yMin)
}

/**
 * Point guaranteed outside (to the upper-right of) the box.
 * @param bb - the bounding box to read from.
 * @param paddingPercent - the padding as a percent of the box extent (default 1).
 * @returns a point offset to the upper-right of `bb`.
 */
export function outsidePointOf(bb: BBox2d, paddingPercent = 1): [number, number] {
  const width = bb.xMax - bb.xMin
  const height = bb.yMax - bb.yMin
  return [bb.xMax + (width / 100) * paddingPercent, bb.yMax + (height / 100) * paddingPercent * 0.9]
}

/**
 * True if `bb` and `other` are completely disjoint.
 * @param bb - the first bounding box.
 * @param other - the second bounding box.
 * @returns true when the two boxes do not overlap (empty boxes count as disjoint).
 */
export function isBBoxOut(bb: BBox2d, other: BBox2d): boolean {
  // Handles degenerate (empty) boxes by treating them as disjoint.
  if (isEmpty(bb) || isEmpty(other)) return true
  return other.xMax < bb.xMin || other.xMin > bb.xMax || other.yMax < bb.yMin || other.yMin > bb.yMax
}

/**
 * True if the point lies inside (or on the boundary of) the box.
 * @param bb - the bounding box to test against.
 * @param pt - the 2D point to test, `[x, y]`.
 * @returns true when `pt` is within (or on) the box.
 */
export function containsPoint(bb: BBox2d, pt: readonly [number, number]): boolean {
  return (
    pt[0] >= bb.xMin && pt[0] <= bb.xMax && pt[1] >= bb.yMin && pt[1] <= bb.yMax
  )
}