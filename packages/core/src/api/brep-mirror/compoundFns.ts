/**
 * Self-hosted compat-op implementations — compound feature family
 * (core-decouple Phase 3, §5.4; drill / pocket / boss / mirrorJoin).
 *
 * @platform occt
 *
 * Semantics mirror brepjs `operations/compoundOpsFns.ts` with the brepjs
 * object model dropped:
 *  - `options.face` supports an omitted default (highest-Z face) or an already
 *    constructed brepjs Face (`{ wrapped }`); FinderFn (brepjs finder DSL) is
 *    not supported after selfhosting.
 *  - `options.profile` must be an already constructed brepjs Wire (`{ wrapped }`);
 *    DrawingLike (sketchOnPlane) is not supported (sketch DSL is the brepjs
 *    compat surface, not a core data type).
 * Intermediates (tool/profile face/positioned face) are released after use.
 */

import type { BrepHandle } from '../../brep/engine/types'
import { getBrepApi } from '../../brep/handle-bridge'
import { ok, err, isErr, type Result } from '../../result/result'
import { kernelError, validationError } from '../../result/errors'
import type { FormClass } from '../internal/dual-form-args'
import { resolveArgs } from '../internal/dual-form-args'
import type { Vec3 } from '../brepjs-compat/types'
import { brepHandleOf, composeAffine, rotationZTo, translationMatrix } from './brepHelpers'

const DRILL_PARAMS = { name: 'drill', params: ['shape', 'options'], formClass: 'A' as FormClass }
const POCKET_PARAMS = { name: 'pocket', params: ['shape', 'options'], formClass: 'A' as FormClass }
const BOSS_PARAMS = { name: 'boss', params: ['shape', 'options'], formClass: 'A' as FormClass }
const MIRROR_JOIN_PARAMS = { name: 'mirrorJoin', params: ['shape', 'options'], formClass: 'A' as FormClass }

// ---------------------------------------------------------------------------
// Vec helpers (brepjs vecOps)
// ---------------------------------------------------------------------------

function vecIsZero(v: readonly number[]): boolean {
  return v[0] === 0 && v[1] === 0 && v[2] === 0
}

function vecNormalize(v: readonly [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2])
  return [v[0] / len, v[1] / len, v[2] / len]
}

function vecScale(v: readonly [number, number, number], k: number): [number, number, number] {
  return [v[0] * k, v[1] * k, v[2] * k]
}

// ---------------------------------------------------------------------------
// Face/profile helpers
// ---------------------------------------------------------------------------

/** 构造位于 pos、沿 dir 轴的 cylinder（radius × height），返回句柄（调用方负责释放/消费）。 */
function cylinderAt(
  kernel: ReturnType<typeof getBrepApi>,
  radius: number,
  height: number,
  pos: [number, number, number],
  dir: [number, number, number],
): BrepHandle {
  const base = kernel.makeCylinder(radius, height)
  const m = composeAffine(rotationZTo(dir), translationMatrix(pos))
  const placed = kernel.located(base, m as number[])
  kernel.release(base)
  return placed
}

/** 解析目标面：省略 → 最高 Z 面（faceCenter 最大）；Face（{wrapped}）→ 直取。 */
function resolveTargetFace(
  kernel: ReturnType<typeof getBrepApi>,
  shape: BrepHandle,
  faceSpec: unknown,
): Result<BrepHandle> {
  if (faceSpec === undefined || faceSpec === null) {
    const faces = kernel.getSubShapes(shape, 'face')
    if (faces.length === 0) {
      return err(validationError('COMPOUND_NO_FACES', 'compoundOps: shape has no faces'))
    }
    let best = faces[0]
    let bestZ = kernel.surfaceCenterOfMass(best).z
    for (let i = 1; i < faces.length; i++) {
      const z = kernel.surfaceCenterOfMass(faces[i]).z
      if (z > bestZ) {
        best = faces[i]
        bestZ = z
      }
    }
    return ok(best)
  }
  if (typeof faceSpec === 'object') {
    try {
      return ok(brepHandleOf(faceSpec))
    } catch {
      return err(
        validationError('COMPOUND_FACE_NOT_FOUND', 'compoundOps: face spec must be a brepjs Face handle or omitted'),
      )
    }
  }
  return err(validationError('COMPOUND_FACE_NOT_FOUND', 'compoundOps: face spec must be a brepjs Face handle or omitted'))
}

/** 面法向（uv 中心，brepjs normalAt）。 */
function faceNormalAt(kernel: ReturnType<typeof getBrepApi>, face: BrepHandle): Vec3 {
  const b = kernel.uvBounds(face)
  const u = 0.5 * (b.uMin + b.uMax)
  const v = 0.5 * (b.vMin + b.vMax)
  const n = kernel.surfaceNormal(face, u, v)
  return [n.x, n.y, n.z]
}

/** 面质心（brepjs faceCenter）。 */
function faceCenterAt(kernel: ReturnType<typeof getBrepApi>, face: BrepHandle): Vec3 {
  const c = kernel.surfaceCenterOfMass(face)
  return [c.x, c.y, c.z]
}

/** profile（brepjs Wire）→ face handle。 */
function profileToFace(kernel: ReturnType<typeof getBrepApi>, profile: unknown): Result<BrepHandle> {
  try {
    const wire = brepHandleOf(profile)
    return ok(kernel.makeFace(wire))
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(
      validationError('COMPOUND_PROFILE_INVALID', `compoundOps: profile must be a brepjs Wire (${raw})`),
    )
  }
}

// ---------------------------------------------------------------------------
// drill — cut a cylinder through the shape
// ---------------------------------------------------------------------------

/**
 * Drill — cut a cylinder through the shape.
 *
 * @param args - Resolved arguments (shape, drill options).
 * @returns The drilled shape as a `BrepHandle`.
 */
export function drillBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, options] = resolveArgs(args, DRILL_PARAMS)
  const kernel = getBrepApi()
  const s = brepHandleOf(shape)
  const { at, radius, axis, depth } = options as {
    at: Vec3 | [number, number]
    radius: number
    axis?: Vec3
    depth?: number
  }
  const ax = (axis ?? [0, 0, 1]) as Vec3

  if (radius <= 0) return err(validationError('DRILL_INVALID_RADIUS', 'Drill radius must be positive'))
  if (vecIsZero(ax)) return err(validationError('DRILL_ZERO_AXIS', 'Drill axis cannot be zero'))

  const dir = vecNormalize([ax[0], ax[1], ax[2]])
  const pos: [number, number, number] = at.length === 2 ? [at[0], at[1], 0] : [at[0], at[1], at[2]]

  let tool: BrepHandle | undefined
  try {
    if (depth !== undefined) {
      tool = cylinderAt(kernel, radius, depth, pos, dir)
    } else {
      // Through-all: project bounding box onto the drill axis, add overshoot.
      const bb = kernel.getBoundingBox(s)
      const corners: [number, number, number][] = [
        [bb.xmin, bb.ymin, bb.zmin],
        [bb.xmax, bb.ymin, bb.zmin],
        [bb.xmin, bb.ymax, bb.zmin],
        [bb.xmax, bb.ymax, bb.zmin],
        [bb.xmin, bb.ymin, bb.zmax],
        [bb.xmax, bb.ymin, bb.zmax],
        [bb.xmin, bb.ymax, bb.zmax],
        [bb.xmax, bb.ymax, bb.zmax],
      ]
      let tMin = Infinity
      let tMax = -Infinity
      for (const c of corners) {
        const t = (c[0] - pos[0]) * dir[0] + (c[1] - pos[1]) * dir[1] + (c[2] - pos[2]) * dir[2]
        if (t < tMin) tMin = t
        if (t > tMax) tMax = t
      }
      const overshoot = 1
      tMin -= overshoot
      tMax += overshoot
      const d = tMax - tMin
      const startPos: [number, number, number] = [
        pos[0] + dir[0] * tMin,
        pos[1] + dir[1] * tMin,
        pos[2] + dir[2] * tMin,
      ]
      tool = cylinderAt(kernel, radius, d, startPos, dir)
    }
    return ok(kernel.cut(s, tool))
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(kernelError('DRILL_FAILED', `drill failed: ${raw}`, e))
  } finally {
    if (tool !== undefined) kernel.release(tool)
  }
}

// ---------------------------------------------------------------------------
// pocket — extrude a profile inward and cut
// ---------------------------------------------------------------------------

/**
 * Pocket — extrude a profile inward and cut it from the shape.
 *
 * @param args - Resolved arguments (shape, pocket options).
 * @returns The pocketed shape as a `BrepHandle`.
 */
export function pocketBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, options] = resolveArgs(args, POCKET_PARAMS)
  const kernel = getBrepApi()
  const s = brepHandleOf(shape)
  const { profile, depth } = options as { profile: unknown; depth: number; face?: unknown }

  if (depth <= 0) return err(validationError('POCKET_INVALID_DEPTH', 'Pocket depth must be positive'))

  const faceRes = resolveTargetFace(kernel, s, (options as { face?: unknown }).face)
  if (isErr(faceRes)) return faceRes
  const face = faceRes.value
  const normal = faceNormalAt(kernel, face)
  const center = faceCenterAt(kernel, face)

  const profRes = profileToFace(kernel, profile)
  if (isErr(profRes)) return profRes
  const profFace = profRes.value

  let positioned: BrepHandle | undefined
  let tool: BrepHandle | undefined
  try {
    positioned = kernel.translate(profFace, center[0], center[1], center[2])
    kernel.release(profFace)
    const nn = vecNormalize([normal[0], normal[1], normal[2]])
    const extDir = vecScale(nn, -depth)
    tool = kernel.extrude(positioned, extDir[0], extDir[1], extDir[2])
    kernel.release(positioned)
    return ok(kernel.cut(s, tool))
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(kernelError('POCKET_FAILED', `pocket failed: ${raw}`, e))
  } finally {
    if (tool !== undefined) kernel.release(tool)
    if (positioned !== undefined) kernel.release(positioned)
  }
}

// ---------------------------------------------------------------------------
// boss — extrude a profile outward and fuse
// ---------------------------------------------------------------------------

/**
 * Boss — extrude a profile outward and fuse it onto the shape.
 *
 * @param args - Resolved arguments (shape, boss options).
 * @returns The shape with the boss fused as a `BrepHandle`.
 */
export function bossBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, options] = resolveArgs(args, BOSS_PARAMS)
  const kernel = getBrepApi()
  const s = brepHandleOf(shape)
  const { profile, height } = options as { profile: unknown; height: number; face?: unknown }

  if (height <= 0) return err(validationError('BOSS_INVALID_HEIGHT', 'Boss height must be positive'))

  const faceRes = resolveTargetFace(kernel, s, (options as { face?: unknown }).face)
  if (isErr(faceRes)) return faceRes
  const face = faceRes.value
  const normal = faceNormalAt(kernel, face)
  const center = faceCenterAt(kernel, face)

  const profRes = profileToFace(kernel, profile)
  if (isErr(profRes)) return profRes
  const profFace = profRes.value

  let positioned: BrepHandle | undefined
  let tool: BrepHandle | undefined
  try {
    positioned = kernel.translate(profFace, center[0], center[1], center[2])
    kernel.release(profFace)
    const nn = vecNormalize([normal[0], normal[1], normal[2]])
    const extDir = vecScale(nn, height)
    tool = kernel.extrude(positioned, extDir[0], extDir[1], extDir[2])
    kernel.release(positioned)
    return ok(kernel.fuse(s, tool))
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(kernelError('BOSS_FAILED', `boss failed: ${raw}`, e))
  } finally {
    if (tool !== undefined) kernel.release(tool)
    if (positioned !== undefined) kernel.release(positioned)
  }
}

// ---------------------------------------------------------------------------
// mirrorJoin — mirror and fuse in one step
// ---------------------------------------------------------------------------

/**
 * Mirror the shape across a plane and fuse the mirrored copy to the original.
 *
 * @param args - Resolved arguments (shape, mirror options).
 * @returns The shape joined with its mirror as a `BrepHandle`.
 */
export function mirrorJoinBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, options] = resolveArgs(args, MIRROR_JOIN_PARAMS)
  const kernel = getBrepApi()
  const s = brepHandleOf(shape)
  const { normal, at } = (options ?? {}) as { normal?: Vec3; at?: Vec3 }
  const n = (normal ?? [1, 0, 0]) as Vec3

  if (vecIsZero(n)) return err(validationError('MIRROR_ZERO_NORMAL', 'Mirror plane normal cannot be zero'))

  const origin = (at ?? [0, 0, 0]) as Vec3
  let mirrored: BrepHandle | undefined
  try {
    mirrored = kernel.mirror(
      s,
      { x: origin[0], y: origin[1], z: origin[2] },
      { x: n[0], y: n[1], z: n[2] },
    )
    return ok(kernel.fuse(s, mirrored))
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(kernelError('MIRROR_JOIN_FAILED', `mirrorJoin failed: ${raw}`, e))
  } finally {
    if (mirrored !== undefined) kernel.release(mirrored)
  }
}
