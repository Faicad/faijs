/**
 * api up-to — shared termination-plane machinery for BREP feature ops.
 *
 * `cad.extrude({ upTo })` resolves a target into a single cut plane and trims a
 * long prism against the half-space that keeps the start side. Drilling / pocket
 * / punch-hole needs the same primitive: build an over-long tool, trim it against
 * the same plane, then subtract. Keeping the resolution + trim in one place makes
 * the four target kinds behave identically across those ops.
 *
 * Layering: this is an internal api/ helper (not a public op). It relies on the
 * BREP kernel only; the mesh chain rejects up-to at each op boundary.
 *
 * GOTCHAs preserved from the original extrude implementation:
 * - The long trial length is derived from the plane-to-profile projection, NOT
 *   the profile's own bbox diagonal (a small profile may never reach a far face).
 * - The retained half-space is the side containing the extrusion origin; the
 *   target face normal may point either way relative to the travel direction.
 * - An explicit plane target auto-orients the travel direction toward the plane;
 *   a plane behind the profile produced a wrong-volume solid without this.
 * - farSideBox is an oriented box (local basis u,v,n), not an axis-aligned one.
 */

import { Vec3 as Vec3C, Mat4 } from '../math3d'
import { matrixToArray } from '../brep/brep-ops'
import { getSolidBoundingBox } from '../brep/brep-utils'
import { resolveSelectorToFaceRefs } from './selectors-to-refs'
import { brepOf } from '../shape'
import type { Shape, Vec3 } from '../mesh/types'
import type { BrepHandle } from '../brep/engine/types'
import type { BrepEngineApi } from '../brep/engine/primitives'
import type { FaceTopoRef } from '../topology/naming'
import { TopoRefError } from '../topology/naming'

/** A resolved infinite cut plane: a point on it plus its (normalized) normal. */
export interface CutPlane {
  point: Vec3
  normal: Vec3
}

/** What the caller knows when resolving / trimming an up-to target. */
export interface UpToContext {
  kernel: BrepEngineApi
  /** Support body for `extent` and `selector` targets. */
  base?: Shape
  /** Travel start (profile center for extrude, hole center for drill). */
  origin: Vec3
  /** Normalized travel direction. */
  direction: Vec3
  /** Cut plane shift along its own normal, mm. */
  offset?: number
}

/**
 * Termination target in canonical form.
 * - `distance` is the legacy numeric form; callers handle it as a plain length.
 * - `face` / `selector` / `extent` / `plane` resolve to a cut plane here.
 */
export type UpToTarget =
  | { kind: 'distance'; value: number }
  | { kind: 'face'; ref: FaceTopoRef }
  | { kind: 'selector'; selector: string }
  | { kind: 'extent'; which: 'first' | 'last' | 'next' }
  | { kind: 'plane'; point: Vec3; normal: Vec3 }

/**
 * Normalize the legacy `ExtrudeUpTo` public shape and the canonical UpToTarget
 * shape into one form. Accepts:
 * - `'last'` / `'first'` → `extent`
 * - any other string → CadQuery face `selector`
 * - `{ plane: { point, normal } }` → `plane`
 * - `FaceTopoRef` literal (has `hint`) → `face`
 * - already-canonical `{ kind, ... }` → passed through
 *
 * @param input - the up-to argument as supplied by a caller.
 * @returns the canonical target.
 * @throws Error on an unrecognized shape (no silent fallback).
 */
export function normalizeUpToTarget(input: unknown): UpToTarget {
  if (typeof input === 'string') {
    if (input === 'last' || input === 'first' || input === 'next') {
      return { kind: 'extent', which: input }
    }
    return { kind: 'selector', selector: input }
  }
  if (!input || typeof input !== 'object') {
    throw new Error('E_UP_TO_BAD_TARGET: upTo expects a number-like extent, face ref, plane, or selector string')
  }
  const o = input as Record<string, unknown>
  if ('plane' in o && o.plane && typeof o.plane === 'object') {
    const p = o.plane as { point: Vec3; normal: Vec3 }
    return { kind: 'plane', point: p.point, normal: p.normal }
  }
  // Canonical face wrapper { kind:'face', ref } (distinct from a FaceTopoRef,
  // which itself carries kind:'face' plus origin/role/hint but no `ref`).
  if (o.kind === 'face' && o.ref && typeof o.ref === 'object' && 'hint' in (o.ref as object)) {
    return input as UpToTarget
  }
  if (
    o.kind === 'extent' || o.kind === 'selector' || o.kind === 'plane' ||
    o.kind === 'distance'
  ) {
    return input as UpToTarget
  }
  // Legacy FaceTopoRef literal produced by faceRef / UI picking.
  if ('hint' in o) return { kind: 'face', ref: input as FaceTopoRef }
  throw new Error('E_UP_TO_BAD_TARGET: unrecognized upTo target object')
}

/** bbox diagonal length — the safety margin base for long tools. */
function bboxDiag(bbox: { min: Vec3; max: Vec3 }): number {
  return Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2])
}

/**
 * Oriented half-space box: local z in [-R, 0] along `faceNormal`, rotated into
 * world space so its n=0 end face lies exactly on the target plane. An axis
 * aligned box produced a stepped cut on sloped planes (measured volume 7076 vs
 * 4860 true) — the oriented basis is required for an exact planar trim.
 */
function farSideBox(kernel: BrepEngineApi, faceCenter: Vec3, faceNormal: Vec3, reach: number): BrepHandle {
  const unit = new Vec3C(...faceNormal).normalize()
  const center = new Vec3C(...faceCenter)
  const aux = Math.abs(unit.y) < 0.9 ? new Vec3C(0, 1, 0) : new Vec3C(1, 0, 0)
  const u = new Vec3C().crossVectors(unit, aux).normalize()
  const v = new Vec3C().crossVectors(unit, u).normalize()
  const R = reach
  const box = kernel.makeBoxFromCorners({ x: -R, y: -R, z: -R }, { x: R, y: R, z: 0 })
  const m = new Mat4().makeBasis(u, v, unit).setPosition(center)
  return kernel.transform(box, matrixToArray(m))
}

/**
 * `extent:'next'`: pick the first face the travel direction meets on the base
 * body, by face-center projection onto the direction. Approximation (documented
 * boundary): face centers, not exact curve/surface intersection; a face whose
 * normal is near-parallel to the travel direction is treated as a cap and its
 * center is used. Faces behind the origin and sideways faces are excluded.
 *
 * @throws Error E_UP_TO_NEXT_NOT_FOUND when no qualifying face is found.
 */
function resolveNextFacePlane(
  kernel: BrepEngineApi,
  baseSolid: BrepHandle,
  origin: Vec3,
  direction: Vec3,
): { center: Vec3; normal: Vec3 } {
  const dir = new Vec3C(...direction).normalize()
  const oProj = new Vec3C(...origin).dot(dir)
  const faces = kernel.getSubShapes(baseSolid, 'face')
  let best: { center: Vec3; normal: Vec3; t: number } | undefined
  for (const face of faces) {
    const c = kernel.surfaceCenterOfMass(face)
    const center: Vec3 = [c.x, c.y, c.z]
    const t = new Vec3C(...center).dot(dir) - oProj
    if (t <= 1e-9) continue // behind or at the origin
    const uv = kernel.uvBounds(face)
    const nv = kernel.surfaceNormal(face, (uv.uMin + uv.uMax) / 2, (uv.vMin + uv.vMax) / 2)
    const nn = new Vec3C(nv.x, nv.y, nv.z).normalize()
    const cos = Math.abs(nn.dot(dir))
    if (cos < 0.5) continue // sideways face, not a termination cap
    if (best === undefined || t < best.t) best = { center, normal: [nn.x, nn.y, nn.z], t }
  }
  if (best === undefined) {
    throw new Error('E_UP_TO_NEXT_NOT_FOUND: no qualifying next face on baseFeature along the travel direction')
  }
  return { center: best.center, normal: best.normal }
}

/**
 * Resolve a canonical target into a cut plane (point already shifted by offset).
 * The returned normal is normalized but keeps the target face's orientation;
 * retained-side selection is done against the travel origin, not this sign.
 *
 * @param target - the canonical up-to target (face/selector/plane/extent).
 * @param ctx - resolution context (base shape, offset, travel origin/direction).
 * @returns the resolved cut plane (center point + normal, offset already applied).
 * @throws Error `E_UP_TO_NO_BASE` when extent/selector targets lack a base.
 * @throws TopoRefError when a selector matches zero or multiple faces.
 */
export function resolveUpToPlane(target: UpToTarget, ctx: UpToContext): CutPlane {
  const offset = ctx.offset ?? 0
  let center: Vec3
  let normal: Vec3
  switch (target.kind) {
    case 'face': {
      const hint = target.ref.hint
      if (!hint.center || !hint.normal) {
        throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', 'upTo: face ref hint has no center/normal snapshot')
      }
      center = [...hint.center] as Vec3
      normal = [...hint.normal] as Vec3
      break
    }
    case 'selector': {
      const base = ctx.base
      if (base === undefined) {
        throw new Error('E_UP_TO_NO_BASE: upTo selector requires a baseFeature shape')
      }
      const refs = resolveSelectorToFaceRefs(base, target.selector)
      if (refs.length === 0) {
        throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', `upTo: selector "${target.selector}" matched no face on baseFeature`)
      }
      if (refs.length > 1) {
        throw new TopoRefError(
          'E_TOPO_NOT_FOUND',
          'face',
          `upTo: selector "${target.selector}" matched ${refs.length} faces; upTo takes exactly one face`,
        )
      }
      const hint = refs[0]!.hint
      if (!hint.center || !hint.normal) {
        throw new TopoRefError('E_TOPO_NOT_FOUND', 'face', 'upTo: selector-resolved face ref hint has no center/normal snapshot')
      }
      center = [...hint.center] as Vec3
      normal = [...hint.normal] as Vec3
      break
    }
    case 'plane':
      center = [...target.point] as Vec3
      normal = [...target.normal] as Vec3
      break
    case 'extent': {
      const base = ctx.base
      if (base === undefined) {
        throw new Error('E_UP_TO_NO_BASE: upTo "last"/"first" requires a baseFeature shape')
      }
      const baseSolid = brepOf(base) as BrepHandle | undefined
      if (baseSolid === undefined) {
        throw new Error('E_UP_TO_NO_BASE: upTo extent requires a baseFeature with a BREP solid')
      }
      if (target.which === 'next') {
        const next = resolveNextFacePlane(ctx.kernel, baseSolid, ctx.origin, ctx.direction)
        center = next.center
        normal = next.normal
        break
      }
      const bb = getSolidBoundingBox(ctx.kernel, baseSolid)
      const n = new Vec3C(...ctx.direction).normalize()
      const c: Vec3 = [
        (bb.min[0] + bb.max[0]) / 2,
        (bb.min[1] + bb.max[1]) / 2,
        (bb.min[2] + bb.max[2]) / 2,
      ]
      const sign = target.which === 'last' ? 1 : -1
      const proj =
        (bb.max[0] - bb.min[0]) * Math.abs(n.x) +
        (bb.max[1] - bb.min[1]) * Math.abs(n.y) +
        (bb.max[2] - bb.min[2]) * Math.abs(n.z)
      center = [
        c[0] + ((n.x * proj) / 2) * sign,
        c[1] + ((n.y * proj) / 2) * sign,
        c[2] + ((n.z * proj) / 2) * sign,
      ]
      normal = [n.x, n.y, n.z]
      break
    }
    case 'distance':
      throw new Error('E_UP_TO_BAD_TARGET: resolveUpToPlane cannot resolve a distance target; callers handle it as a plain length')
  }
  const tn = new Vec3C(...normal).normalize()
  return {
    point: [center[0] + tn.x * offset, center[1] + tn.y * offset, center[2] + tn.z * offset],
    normal: [tn.x, tn.y, tn.z],
  }
}

/**
 * Build an over-long extrusion of `source` along `ctx.direction` and trim it
 * against the resolved cut plane, keeping the side that contains the origin.
 * This is the workhorse used by `extrude` (source = profile face). Trimming an
 * already-built tool (drill / pocket) uses the same retained-side rules.
 *
 * @param kernel - the active BREP kernel.
 * @param source - the profile solid to extrude.
 * @param target - canonical termination target.
 * @param ctx - resolution context (origin / direction / base / offset).
 * @returns the trimmed solid handle.
 * @throws Error E_UP_TO_PARALLEL / E_UP_TO_NO_INTERSECTION on degenerate cases.
 */
export function clipByUpToPlane(
  kernel: BrepEngineApi,
  source: BrepHandle,
  target: UpToTarget,
  ctx: UpToContext,
): BrepHandle {
  const plane = resolveUpToPlane(target, ctx)
  const bbox = getSolidBoundingBox(kernel, source)
  const dir = new Vec3C(...ctx.direction).normalize()
  const origin = ctx.origin

  // Explicit plane targets auto-orient toward the plane: a plane behind the
  // profile in local coordinates must reverse the travel direction.
  if (target.kind === 'plane') {
    const tn = new Vec3C(...plane.normal).normalize()
    const dAuto =
      (origin[0] - plane.point[0]) * tn.x +
      (origin[1] - plane.point[1]) * tn.y +
      (origin[2] - plane.point[2]) * tn.z
    const denom = dir.dot(tn)
    if (Math.abs(denom) > 1e-12) {
      const tAuto = -dAuto / denom
      if (tAuto < 0) dir.multiplyScalar(-1)
    }
  }

  const tn = new Vec3C(...plane.normal).normalize()
  const planeD = new Vec3C(...plane.point).dot(tn)
  const dirD = dir.dot(tn)
  if (Math.abs(dirD) < 1e-9) {
    throw new Error('E_UP_TO_PARALLEL: extrusion direction is parallel to the target face plane')
  }
  const corners: Vec3[] = [
    [bbox.min[0], bbox.min[1], bbox.min[2]],
    [bbox.max[0], bbox.min[1], bbox.min[2]],
    [bbox.min[0], bbox.max[1], bbox.min[2]],
    [bbox.max[0], bbox.max[1], bbox.min[2]],
    [bbox.min[0], bbox.min[1], bbox.max[2]],
    [bbox.max[0], bbox.min[1], bbox.max[2]],
    [bbox.min[0], bbox.max[1], bbox.max[2]],
    [bbox.max[0], bbox.max[1], bbox.max[2]],
  ]
  const tMax = corners
    .map((p) => (planeD - new Vec3C(...p).dot(tn)) / dirD)
    .reduce((a, b) => Math.max(a, b), 0)
  const offset = Math.abs(ctx.offset ?? 0)
  const L = tMax + offset + bboxDiag(bbox) * 0.1 + 1
  const longSolid = kernel.extrude(source, dir.x * L, dir.y * L, dir.z * L)

  return trimToPlane(kernel, longSolid, plane, origin, dir.toArray() as Vec3, bboxDiag(bbox) + offset + 1)
}

/**
 * Trim an already-built long solid (prism or drill tool) against a cut plane,
 * keeping the side that contains the travel origin. This is the shared tail of
 * both `clipByUpToPlane` (extrude) and the drill / pocket tool path.
 *
 * @param kernel - BREP kernel.
 * @param solid - the long solid/tool to trim (consumed and released here).
 * @param plane - the resolved cut plane.
 * @param origin - travel start; the retained side contains this point.
 * @param dir - normalized travel direction (fallback side when origin lies on the plane).
 * @param reachPad - extra half-space reach beyond plane-to-origin distance.
 * @returns the trimmed solid handle.
 * @throws Error E_UP_TO_NO_INTERSECTION when nothing survives the cut.
 */
export function trimToPlane(
  kernel: BrepEngineApi,
  solid: BrepHandle,
  plane: CutPlane,
  origin: Vec3,
  dir: Vec3,
  reachPad: number,
): BrepHandle {
  const tn = new Vec3C(...plane.normal).normalize()
  const d = new Vec3C(...origin).sub(new Vec3C(...plane.point)).dot(tn)
  const dirC = new Vec3C(...dir).normalize()
  // Retained-side normal: the side containing origin (d same sign as tn → +;
  // opposite → -); d≈0 degenerates to the travel direction.
  const keepSide = Math.abs(d) < 1e-9 ? dirC.clone() : tn.clone().multiplyScalar(Math.sign(d))
  const reach = new Vec3C(...plane.point).distanceTo(new Vec3C(...origin)) + reachPad
  // farSideBox covers the opposite of the passed normal, so pass -keepSide.
  const halfspace = farSideBox(kernel, plane.point, [-keepSide.x, -keepSide.y, -keepSide.z], reach)
  const clipped = kernel.common(solid, halfspace)
  kernel.release(solid)
  kernel.release(halfspace)

  const clippedBBox = getSolidBoundingBox(kernel, clipped)
  if (!Number.isFinite(bboxDiag(clippedBBox)) || bboxDiag(clippedBBox) < 1e-9) {
    kernel.release(clipped)
    throw new Error('E_UP_TO_NO_INTERSECTION: tool does not reach the target face')
  }
  return clipped
}
