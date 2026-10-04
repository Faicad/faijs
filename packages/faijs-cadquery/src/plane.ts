/**
 * Plane coordinate transforms — CadQuery `Plane.toLocalCoords` /
 * `Plane.mirrorInPlane` parity (Stage 5 gap, audit §3.4). These are the
 * "arbitrary-plane" transforms faijs-cadquery only partially covered with
 * `mirrorX` / `mirrorY` (workplane-local axis-aligned mirrors).
 *
 * The engine already exposes `generalTransform(shape, matrix)` (a 3×4
 * row-major affine matrix) and `composeTransform` through `getBrepApi`; we
 * only lift them onto a plane frame here — no core changes.
 *
 * Matrix convention (occt-wasm `generalTransform`, 3×4 row-major): for a point
 * (x,y,z) the new coordinate of row i is `m[i*4..i*4+2] · (x,y,z) + m[i*4+3]`.
 */

import { getKernel } from '@faicad/faijs/occt-kernel/occtKernel'
import type { OcctKernel, ShapeHandle } from 'occt-wasm'

import { brepOf, isShape } from '@faicad/faijs/shape'
import { fromHandle } from '@faicad/faijs/sdk'
import type { Shape } from '@faicad/faijs/mesh/types'
import type { Workplane } from './workplane'

import { unwrapShape, wrapShape, type CqShape } from './shape-class'

/** A plane frame: origin + right-handed orthonormal basis (xDir, yDir, normal). */
export interface CqPlane {
  /** plane origin in world coordinates */
  origin: [number, number, number]
  /** plane local +X in world coordinates */
  xDir: [number, number, number]
  /** plane local +Y in world coordinates (= normal × xDir) */
  yDir: [number, number, number]
  /** plane local +Z (the plane normal) in world coordinates */
  normal: [number, number, number]
}

function k(): OcctKernel {
  return getKernel() as unknown as OcctKernel
}

/**
 * Resolve a plane-transform input to a raw occt handle.
 *
 * The unit tests feed an occt `CqShape` / bare `ShapeHandle` directly (so the
 * function returns a `CqShape`, matching upstream's `Solid → Solid` shape). The
 * `.fai.js` mirror runtime, however, only produces mesh-backed `Workplane`s
 * (and `cq.val(wp)` returns a mesh `Shape`), never an occt `CqShape` — so the
 * raw `unwrapShape` path would treat the mesh object as a handle and fail with
 * "Invalid shape ID: 0". When a `Workplane` (or mesh `Shape`) is passed we
 * recover its brep handle via `brepOf`, transform it, and return a mesh `Shape`
 * (carrying the transformed handle) that the runtime can export. Both call
 * styles keep their original return type, so existing tests are untouched.
 */
type PlaneTransformInput = CqShape | ShapeHandle | Workplane | Shape
function resolveInputHandle(shape: PlaneTransformInput): { handle: ShapeHandle; fromWorkplane: boolean } {
  if (shape && typeof shape === 'object') {
    // Workplane: recover the brep handle from its current stack shape.
    const maybeWp = shape as unknown as Workplane
    if ('objects' in maybeWp && 'shape' in maybeWp) {
      const src = maybeWp.shape
      if (src !== undefined && src !== null) {
        const h = brepOf(src)
        if (h === undefined) {
          throw new Error('[plane] transform: Workplane shape carries no brep handle (mesh-only?)')
        }
        return { handle: h as ShapeHandle, fromWorkplane: true }
      }
    }
    // Bare core faijs Shape (e.g. the value returned by `cq.val(wp)`):
    // recover its registered brep handle. `unwrapShape` would mistake the
    // mesh object for a handle and fail with "Invalid shape ID: 0".
    if (isShape(shape)) {
      const h = brepOf(shape as Shape)
      if (h === undefined) {
        throw new Error('[plane] transform: shape carries no brep handle (mesh-only?)')
      }
      return { handle: h as ShapeHandle, fromWorkplane: true }
    }
  }
  return { handle: unwrapShape(shape as CqShape | ShapeHandle), fromWorkplane: false }
}

function dot(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

function vsub(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}

/**
 * World → local 3×4 row-major matrix for a plane frame.
 *
 * Maps a world point to its `(x,y,z)` coordinates expressed in the plane basis
 * (x along xDir, y along yDir, z along normal).
 */
function worldToLocalMatrix(p: CqPlane): number[] {
  const t0 = -dot(p.xDir, p.origin)
  const t1 = -dot(p.yDir, p.origin)
  const t2 = -dot(p.normal, p.origin)
  return [
    p.xDir[0], p.xDir[1], p.xDir[2], t0,
    p.yDir[0], p.yDir[1], p.yDir[2], t1,
    p.normal[0], p.normal[1], p.normal[2], t2,
  ]
}

/**
 * Local → world 3×4 row-major matrix for a plane frame (the inverse of
 * {@link worldToLocalMatrix} for an orthonormal frame).
 */
function localToWorldMatrix(p: CqPlane): number[] {
  return [
    p.xDir[0], p.yDir[0], p.normal[0], p.origin[0],
    p.xDir[1], p.yDir[1], p.normal[1], p.origin[1],
    p.xDir[2], p.yDir[2], p.normal[2], p.origin[2],
  ]
}

/**
 * `Plane.toLocalCoords` — transform a shape so its coordinates are expressed in
 * the plane's local frame (x→xDir, y→yDir, z→normal). The plane origin becomes
 * the new origin.
 * @param plane - target plane frame
 * @param shape - shape to transform (wrapper or bare handle)
 * @returns the transformed shape (same kind, owned)
 */
export function toLocalCoords(plane: CqPlane, shape: CqShape | ShapeHandle): CqShape
/** Workplane / mesh-`Shape` form of {@link toLocalCoords}.
 * @param plane - target plane frame
 * @param shape - Workplane or mesh Shape to transform
 * @returns the transformed mesh Shape
 */
export function toLocalCoords(plane: CqPlane, shape: Workplane | Shape): Shape
export function toLocalCoords(plane: CqPlane, shape: PlaneTransformInput): CqShape | Shape {
  const { handle, fromWorkplane } = resolveInputHandle(shape)
  const out = k().generalTransform(handle, worldToLocalMatrix(plane))
  return fromWorkplane ? fromHandle(out) : wrapShape('solid', out)
}

/**
 * `Plane.toWorldCoords` — inverse of {@link toLocalCoords}: transform a shape
 * from the plane's local frame back to world coordinates.
 * @param plane - source plane frame
 * @param shape - shape expressed in the plane's local frame
 * @returns the transformed shape (same kind, owned)
 */
export function toWorldCoords(plane: CqPlane, shape: CqShape | ShapeHandle): CqShape
/** Workplane / mesh-`Shape` form of {@link toWorldCoords}.
 * @param plane - source plane frame
 * @param shape - Workplane or mesh Shape expressed in the plane's local frame
 * @returns the transformed mesh Shape
 */
export function toWorldCoords(plane: CqPlane, shape: Workplane | Shape): Shape
export function toWorldCoords(plane: CqPlane, shape: PlaneTransformInput): CqShape | Shape {
  const { handle, fromWorkplane } = resolveInputHandle(shape)
  const out = k().generalTransform(handle, localToWorldMatrix(plane))
  return fromWorkplane ? fromHandle(out) : wrapShape('solid', out)
}

/**
 * `Plane.mirrorInPlane` — reflect a shape about one of the plane's axes.
 * GOTCHA (probe-verified against CadQuery 2.8.0): `axis='X'` reflects about
 * the plane's **X axis** (local y and z flip), and `axis='Y'` about the Y axis
 * (local x and z flip) — NOT a reflection across the Y–Z / X–Z plane. CadQuery
 * returns a `Shell`; faijs keeps the input topology (a solid stays a solid) —
 * the mirrored geometry is identical, only the topological type differs.
 * @param plane - mirror plane frame
 * @param shape - shape to mirror
 * @param axis - which local axis to flip about ('X' default, 'Y')
 * @returns the mirrored shape (same kind, owned)
 */
export function mirrorInPlane(plane: CqPlane, shape: CqShape | ShapeHandle, axis?: 'X' | 'Y'): CqShape
/** Workplane / mesh-`Shape` form of {@link mirrorInPlane}.
 * @param plane - mirror plane frame
 * @param shape - Workplane or mesh Shape to mirror
 * @param axis - which local axis to flip about ('X' default, 'Y')
 * @returns the mirrored mesh Shape
 */
export function mirrorInPlane(plane: CqPlane, shape: Workplane | Shape, axis?: 'X' | 'Y'): Shape
export function mirrorInPlane(
  plane: CqPlane,
  shape: PlaneTransformInput,
  axis: 'X' | 'Y' = 'X',
): CqShape | Shape {
  const { handle, fromWorkplane } = resolveInputHandle(shape)
  const out = k().generalTransform(handle, reflectMatrix(plane, axis))
  return fromWorkplane ? fromHandle(out) : wrapShape('solid', out)
}

/**
 * Reflection matrix (3×4 row-major) for `mirrorInPlane`: reflect about the
 * line through `plane.origin` along `plane.xDir` (axis='X') or `plane.yDir`
 * (axis='Y'). The rotation part is the Householder reflection `R = -I +
 * 2·u⊗u`; the translation keeps the axis passing through the plane origin.
 */
function reflectMatrix(plane: CqPlane, axis: 'X' | 'Y'): number[] {
  const u = axis === 'X' ? plane.xDir : plane.yDir
  const R = [
    2 * u[0] * u[0] - 1, 2 * u[0] * u[1], 2 * u[0] * u[2],
    2 * u[1] * u[0], 2 * u[1] * u[1] - 1, 2 * u[1] * u[2],
    2 * u[2] * u[0], 2 * u[2] * u[1], 2 * u[2] * u[2] - 1,
  ]
  const ou = dot(plane.origin, u)
  const T = [
    2 * (plane.origin[0] - ou * u[0]),
    2 * (plane.origin[1] - ou * u[1]),
    2 * (plane.origin[2] - ou * u[2]),
  ]
  return [
    R[0], R[1], R[2], T[0],
    R[3], R[4], R[5], T[1],
    R[6], R[7], R[8], T[2],
  ]
}

/**
 * Vector form of `Plane.toLocalCoords`: express a world point in the plane's
 * local coordinates (no kernel call — pure basis projection).
 * @param plane - plane frame
 * @param v - world point
 * @returns `[x, y, z]` local coordinates
 */
export function toLocalCoordsVec(plane: CqPlane, v: [number, number, number]): [number, number, number] {
  const d = vsub(v, plane.origin)
  return [dot(d, plane.xDir), dot(d, plane.yDir), dot(d, plane.normal)]
}

/**
 * Vector form of `Plane.mirrorInPlane`: reflect a world point about one of the
 * plane's axes (no kernel call — pure basis reflection).
 * @param plane - mirror plane frame
 * @param v - world point
 * @param axis - which local axis to flip ('X' default, 'Y')
 * @returns the reflected world point
 */
export function mirrorInPlaneVec(
  plane: CqPlane,
  v: [number, number, number],
  axis: 'X' | 'Y' = 'X',
): [number, number, number] {
  const m = reflectMatrix(plane, axis)
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2] + m[3],
    m[4] * v[0] + m[5] * v[1] + m[6] * v[2] + m[7],
    m[8] * v[0] + m[9] * v[1] + m[10] * v[2] + m[11],
  ]
}
