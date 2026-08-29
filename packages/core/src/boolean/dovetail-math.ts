/**
 * Vector math helpers for the dovetail boolean algorithm.
 * Extracted to a separate module so they can be unit-tested.
 * These are pure functions with no dependencies (no THREE.js).
 */

export type Vec3 = [number, number, number]

export function vec3Cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

export function vec3Dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

export function vec3Normalize(a: Vec3): Vec3 {
  const len = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
  if (len < 1e-12) return [0, 0, 0]
  return [a[0] / len, a[1] / len, a[2] / len]
}

export function vec3Scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s]
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

/** Rodrigues' rotation formula: rotate vector v around unit axis k by angleRad. */
export function vec3RotateAroundAxis(v: Vec3, k: Vec3, angleRad: number): Vec3 {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  const kNorm = vec3Normalize(k)
  const kCrossV = vec3Cross(kNorm, v)
  const kDotV = vec3Dot(kNorm, v)
  return [
    v[0] * cos + kCrossV[0] * sin + kNorm[0] * kDotV * (1 - cos),
    v[1] * cos + kCrossV[1] * sin + kNorm[1] * kDotV * (1 - cos),
    v[2] * cos + kCrossV[2] * sin + kNorm[2] * kDotV * (1 - cos),
  ]
}
