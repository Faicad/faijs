/**
 * brep-operations helpers — shared utilities for self-hosted compat-op implementations
 * (core-decouple Phase 3, §5.4).
 *
 * @module
 */

import type { BrepHandle } from '../../brep/engine/types'
import { brepOf } from '../../shape'

/**
 * Extract a core BREP handle from an op argument.
 *
 * Accepts (in order of preference):
 *  - a raw branded number (BrepHandle),
 *  - a brepjs-style kernel handle object `{ id }`,
 *  - a brepjs-style shape wrapper `{ wrapped }`,
 *  - a faijs Shape whose brep slot carries the handle.
 *
 * @param v - the op argument (positional, post D11 normalization).
 * @returns the numeric BREP handle.
 * @throws when no handle can be extracted (E_BREP_INPUT).
 */
export function brepHandleOf(v: unknown): BrepHandle {
  if (typeof v === 'number') return v as BrepHandle
  if (v !== null && typeof v === 'object') {
    const rec = v as Record<string, unknown>
    if (typeof rec.id === 'number') return rec.id as BrepHandle
    if ('wrapped' in rec) return brepHandleOf(rec.wrapped)
    const solid = brepOf(v as never)
    if (typeof solid === 'number') return solid as BrepHandle
  }
  throw new Error('[brep-operations] E_BREP_INPUT: argument carries no BREP handle')
}

/** Identity 3×4 row-major affine matrix (12 elements). */
export const IDENTITY_3X4: readonly number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]

/**
 * Compose two 3×4 row-major affine matrices: `a` applied first, then `b`
 * (column-vector convention: p' = b·(a·p)).
 *
 * @param a - first matrix (12 elements).
 * @param b - second matrix (12 elements).
 * @returns the composed 12-element matrix.
 */
export function composeAffine(a: readonly number[], b: readonly number[]): number[] {
  const out = new Array<number>(12)
  for (let r = 0; r < 3; r++) {
    const a0 = a[r * 4],
      a1 = a[r * 4 + 1],
      a2 = a[r * 4 + 2],
      a3 = a[r * 4 + 3]
    for (let c = 0; c < 3; c++) out[r * 4 + c] = a0 * b[c] + a1 * b[4 + c] + a2 * b[8 + c]
    out[r * 4 + 3] = a0 * b[3] + a1 * b[7] + a2 * b[11] + a3
  }
  return out
}

/**
 * 3×4 translation matrix for a vector.
 * @param v - Translation vector.
 * @returns The 3×4 translation matrix.
 */
export function translationMatrix(v: readonly [number, number, number]): number[] {
  return [1, 0, 0, v[0], 0, 1, 0, v[1], 0, 0, 1, v[2]]
}

/**
 * 3×4 rotation matrix rotating `angleDeg` degrees around the axis (unit-ized)
 * passing through `center`. Rodrigues formula, column-vector convention.
 *
 * @param axis - Rotation axis (unit-ized internally).
 * @param center - Point the rotation passes through.
 * @param angleDeg - Rotation angle in degrees.
 * @returns The 3×4 rotation matrix.
 */
export function rotationMatrix(
  axis: readonly [number, number, number],
  center: readonly [number, number, number],
  angleDeg: number,
): number[] {
  let [ux, uy, uz] = axis
  const len = Math.hypot(ux, uy, uz)
  if (len < 1e-12) throw new Error('[brep-operations] rotation: zero-length axis')
  ux /= len
  uy /= len
  uz /= len
  const th = (angleDeg * Math.PI) / 180
  const c = Math.cos(th)
  const s = Math.sin(th)
  const t = 1 - c
  const [cx, cy, cz] = center

  const r00 = t * ux * ux + c
  const r01 = t * ux * uy - s * uz
  const r02 = t * ux * uz + s * uy
  const r10 = t * ux * uy + s * uz
  const r11 = t * uy * uy + c
  const r12 = t * uy * uz - s * ux
  const r20 = t * ux * uz - s * uy
  const r21 = t * uy * uz + s * ux
  const r22 = t * uz * uz + c

  return [
    r00, r01, r02, cx - r00 * cx - r01 * cy - r02 * cz,
    r10, r11, r12, cy - r10 * cx - r11 * cy - r12 * cz,
    r20, r21, r22, cz - r20 * cx - r21 * cy - r22 * cz,
  ]
}

/**
 * 3×4 matrix rotating the +Z axis onto `axis` (unit-ized), origin-centered.
 * @param axis - Target axis direction.
 * @returns The 3×4 rotation matrix.
 */
export function rotationZTo(axis: readonly [number, number, number]): number[] {
  const [x, y, z] = axis
  const len = Math.hypot(x, y, z)
  if (len < 1e-12) throw new Error('[brep-operations] rotationZTo: zero-length axis')
  const nx = x / len
  const ny = y / len
  const nz = z / len
  if (Math.abs(nz - 1) < 1e-9) return [...IDENTITY_3X4]
  // Rodrigues rotation from [0,0,1] to [nx,ny,nz].
  const cross = [-ny, nx, 0] // [0,0,1] × axis
  const crossLen = Math.hypot(...cross)
  const kx = cross[0] / crossLen
  const ky = cross[1] / crossLen
  const kz = cross[2] / crossLen
  const cosA = nz
  const sinA = Math.hypot(nx, ny)
  const t = 1 - cosA
  return [
    t * kx * kx + cosA, t * kx * ky - sinA * kz, t * kx * kz + sinA * ky, 0,
    t * kx * ky + sinA * kz, t * ky * ky + cosA, t * ky * kz - sinA * kx, 0,
    t * kx * kz - sinA * ky, t * ky * kz + sinA * kx, t * kz * kz + cosA, 0,
  ]
}
