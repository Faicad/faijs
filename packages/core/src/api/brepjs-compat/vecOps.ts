/**
 * Pure vector operations on Vec3 tuples.
 *
 * 第一方模块（2026-09-25 core-decouple Phase 1）：复制自 brepjs
 * `src/core/vecOps.ts`（同源复制，签名不变）；import 来源改为 compat 面
 * 第一方 `types.ts`。
 */

import type { Vec3 } from './types';

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

/** Add two 3D vectors component-wise.
 *
 * @param a - First vector.
 * @param b - Second vector.
 * @returns The component-wise sum `a + b`.
 */
export function vecAdd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Subtract vector `b` from vector `a` component-wise.
 *
 * @param a - Vector to subtract from.
 * @param b - Vector to subtract.
 * @returns The component-wise difference `a - b`.
 */
export function vecSub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Multiply each component of a 3D vector by a scalar.
 *
 * @param v - Vector to scale.
 * @param s - Scalar multiplier.
 * @returns The scaled vector.
 */
export function vecScale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

/** Negate all components of a 3D vector.
 *
 * @param v - Vector to negate.
 * @returns The negated vector `-v`.
 */
export function vecNegate(v: Vec3): Vec3 {
  return [-v[0], -v[1], -v[2]];
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/** Compute the dot product of two 3D vectors.
 *
 * @param a - First vector.
 * @param b - Second vector.
 * @returns The scalar dot product `a · b`.
 */
export function vecDot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Compute the cross product of two 3D vectors.
 *
 * @param a - First vector.
 * @param b - Second vector.
 * @returns The cross product `a × b`.
 */
export function vecCross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

// ---------------------------------------------------------------------------
// Length / distance
// ---------------------------------------------------------------------------

/** Compute the Euclidean length of a 3D vector.
 *
 * @param v - Vector to measure.
 * @returns The Euclidean length of `v`.
 */
export function vecLength(v: Vec3): number {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

/** Compute the squared length of a 3D vector (avoids a sqrt).
 *
 * @param v - Vector to measure.
 * @returns The squared Euclidean length of `v`.
 */
export function vecLengthSq(v: Vec3): number {
  return v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
}

/** Compute the Euclidean distance between two 3D points.
 *
 * @param a - First point.
 * @param b - Second point.
 * @returns The distance `|a - b|`.
 */
export function vecDistance(a: Vec3, b: Vec3): number {
  return vecLength(vecSub(a, b));
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** Return a unit-length vector in the same direction, or `[0,0,0]` for near-zero input.
 *
 * @param v - Vector to normalize.
 * @returns A unit-length vector in the same direction, or `[0,0,0]`.
 */
export function vecNormalize(v: Vec3): Vec3 {
  const len = vecLength(v);
  if (len < 1e-10) return [0, 0, 0];
  return [v[0] / len, v[1] / len, v[2] / len];
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Test whether two 3D vectors are approximately equal.
 *
 * @param a - First vector.
 * @param b - Second vector.
 * @param tolerance - Per-component absolute tolerance.
 * @returns True if the vectors are approximately equal.
 * @default tolerance `1e-5`
 */
export function vecEquals(a: Vec3, b: Vec3, tolerance = 1e-5): boolean {
  return (
    Math.abs(a[0] - b[0]) < tolerance &&
    Math.abs(a[1] - b[1]) < tolerance &&
    Math.abs(a[2] - b[2]) < tolerance
  );
}

/**
 * Test whether a 3D vector is approximately zero-length.
 *
 * @param v - Vector to test.
 * @param tolerance - Length threshold below which the vector is considered zero.
 * @returns True if the vector is approximately zero-length.
 * @default tolerance `1e-10`
 */
export function vecIsZero(v: Vec3, tolerance = 1e-10): boolean {
  return vecLengthSq(v) < tolerance * tolerance;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/**
 * Compute the unsigned angle between two 3D vectors in **radians**.
 *
 * @param a - First vector.
 * @param b - Second vector.
 * @returns Angle in `[0, PI]`, or `0` if either vector is zero-length.
 */
export function vecAngle(a: Vec3, b: Vec3): number {
  const dot = vecDot(a, b);
  const lenA = vecLength(a);
  const lenB = vecLength(b);
  if (lenA < 1e-10 || lenB < 1e-10) return 0;
  const cosAngle = Math.max(-1, Math.min(1, dot / (lenA * lenB)));
  return Math.acos(cosAngle);
}

/** Project vector onto plane defined by its normal
 *
 * @param v - Vector to project.
 * @param planeOrigin - A point on the plane.
 * @param planeNormal - Plane normal (need not be unit length).
 * @returns The projection of `v` onto the plane.
 */
export function vecProjectToPlane(v: Vec3, planeOrigin: Vec3, planeNormal: Vec3): Vec3 {
  const relative = vecSub(v, planeOrigin);
  const normalLen = vecLengthSq(planeNormal);
  if (normalLen < 1e-20) return v;
  const projection = vecScale(planeNormal, vecDot(relative, planeNormal) / normalLen);
  return vecSub(v, projection);
}

/** Rotate vector around an axis by angle (radians)
 *
 * @param v - Vector to rotate.
 * @param axis - Rotation axis (need not be unit length).
 * @param angleRad - Rotation angle in radians.
 * @returns The rotated vector.
 */
export function vecRotate(v: Vec3, axis: Vec3, angleRad: number): Vec3 {
  const n = vecNormalize(axis);
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dot = vecDot(v, n);
  const cross = vecCross(n, v);

  return [
    v[0] * cos + cross[0] * sin + n[0] * dot * (1 - cos),
    v[1] * cos + cross[1] * sin + n[1] * dot * (1 - cos),
    v[2] * cos + cross[2] * sin + n[2] * dot * (1 - cos),
  ];
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

/** Format a Vec3 as a human-readable string rounded to 3 decimal places.
 *
 * @param v - Vector to format.
 * @returns A human-readable representation of `v`.
 */
export function vecRepr(v: Vec3): string {
  return `x: ${round3(v[0])}, y: ${round3(v[1])}, z: ${round3(v[2])}`;
}
