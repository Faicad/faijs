/**
 * geometry2d — small 2D point / vector helpers shared by the sketcher pens and
 * the draw package. Pure TS, zero dependency.
 *
 * Ported from brepjs `2d/lib`-style utilities (Apache-2.0).
 *
 * @module
 */

/**
 * Euclidean distance between two 2D points.
 * @param a - first point.
 * @param b - second point.
 * @returns the distance.
 */
export function distance2d(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1])
}

/**
 * True when two 2D points coincide within `eps`.
 * @param a - first point.
 * @param b - second point.
 * @param eps - coincidence tolerance (default 1e-9).
 * @returns whether `a` and `b` are the same point.
 */
export function samePoint(a: readonly [number, number], b: readonly [number, number], eps = 1e-9): boolean {
  return distance2d(a, b) <= eps
}

/**
 * Convert polar `[r, theta]` (radians) to Cartesian `[x, y]`.
 * @param r - radial distance.
 * @param theta - angle in radians.
 * @returns the Cartesian point.
 */
export function polarToCartesian(r: number, theta: number): [number, number] {
  return [r * Math.cos(theta), r * Math.sin(theta)]
}

/**
 * Normalize a 2D vector to unit length.
 * @param v - the input vector.
 * @returns the unit vector (the zero vector normalizes to `[1,0]`).
 */
export function normalize2d(v: readonly [number, number]): [number, number] {
  const len = Math.hypot(v[0], v[1])
  if (len < 1e-12) return [1, 0]
  return [v[0] / len, v[1] / len]
}

/**
 * Absolute polar angle of `b` relative to `a`.
 * @param a - the reference point.
 * @param b - the target point.
 * @returns the angle in radians, in `[0, 2π)`.
 */
export function polarAngle2d(a: readonly [number, number], b: readonly [number, number]): number {
  return Math.atan2(b[1] - a[1], b[0] - a[0])
}