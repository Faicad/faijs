/**
 * Self-hosted compat-op implementations — pattern family
 * (core-decouple Phase 3, §5.4; G4).
 *
 * @platform occt
 *
 * Semantics mirror brepjs `operations/patternFns.ts` + `compoundOpsFns.ts`
 * rectangularPattern, on the L1 pattern primitives (occt-primitives:
 * native compound split per replica; gridPattern pre-fused compound).
 * Guards: PATTERN_INVALID_COUNT / PATTERN_ZERO_DIRECTION / PATTERN_ZERO_AXIS.
 */

import type { BrepHandle } from '../../brep/engine/types'
import { getBrepApi } from '../../brep/handle-bridge'
import { ok, err, type Result } from '../../result/result'
import { validationError } from '../../result/errors'
import type { FormClass } from '../internal/dual-form-args'
import { resolveArgs } from '../internal/dual-form-args'
import type { Vec3 } from '../geom-types/types'
import { brepHandleOf } from './brepHelpers'

const LINEAR_PATTERN_PARAMS = { name: 'linearPattern', params: ['shape', 'direction', 'count', 'spacing'], formClass: 'A' as FormClass }
const CIRCULAR_PATTERN_PARAMS = { name: 'circularPattern', params: ['shape', 'axis', 'count', 'fullAngle', 'center'], formClass: 'A' as FormClass }
const GRID_PATTERN_PARAMS = { name: 'gridPattern', params: ['shape', 'directionX', 'directionY', 'countX', 'countY', 'spacingX', 'spacingY'], formClass: 'A' as FormClass }
const RECT_PATTERN_PARAMS = { name: 'rectangularPattern', params: ['shape', 'options'], formClass: 'A' as FormClass }

function vecIsZero(v: readonly number[]): boolean {
  return v[0] === 0 && v[1] === 0 && v[2] === 0
}

function vecNormalize(v: readonly [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2])
  return [v[0] / len, v[1] / len, v[2] / len]
}

/** fuse 全部 replicas 并释放中间句柄（brepjs fuseAll sameFace 等价）。 */
function fuseReplicas(kernel: ReturnType<typeof getBrepApi>, copies: BrepHandle[]): BrepHandle {
  const fused = kernel.fuseAll(copies)
  for (const c of copies) kernel.release(c)
  return fused
}

// ---------------------------------------------------------------------------
// linearPattern — 沿方向复制（brepjs patternFns.ts#linearPattern）
// ---------------------------------------------------------------------------

/**
 * Linear pattern — copy a shape along a direction (brepjs patternFns.ts#linearPattern).
 *
 * @param args - Resolved arguments (shape, direction, count, spacing).
 * @returns The fused pattern copies as a `BrepHandle`.
 */
export function linearPatternBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, direction, count, spacing] = resolveArgs(args, LINEAR_PATTERN_PARAMS)
  const kernel = getBrepApi()
  const s = brepHandleOf(shape)
  const n = Number(count)
  if (n < 1) {
    return err(validationError('PATTERN_INVALID_COUNT', 'Pattern count must be at least 1'))
  }
  if (n === 1) return ok(s)
  const dir = (direction ?? [0, 0, 0]) as Vec3
  if (vecIsZero(dir)) {
    return err(validationError('PATTERN_ZERO_DIRECTION', 'Pattern direction cannot be zero'))
  }
  const nn = vecNormalize([dir[0], dir[1], dir[2]])
  const copies = kernel.linearPattern(
    s,
    { x: nn[0], y: nn[1], z: nn[2] },
    Number(spacing),
    n,
  )
  return ok(fuseReplicas(kernel, copies))
}

// ---------------------------------------------------------------------------
// circularPattern — 绕轴环形复制（brepjs patternFns.ts#circularPattern）
// ---------------------------------------------------------------------------

/**
 * Circular pattern — copy a shape around an axis (brepjs patternFns.ts#circularPattern).
 *
 * @param args - Resolved arguments (shape, axis, count, fullAngle, center).
 * @returns The fused pattern copies as a `BrepHandle`.
 */
export function circularPatternBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, axis, count, fullAngle, center] = resolveArgs(args, CIRCULAR_PATTERN_PARAMS)
  const kernel = getBrepApi()
  const s = brepHandleOf(shape)
  const n = Number(count)
  if (n < 1) {
    return err(validationError('PATTERN_INVALID_COUNT', 'Pattern count must be at least 1'))
  }
  if (n === 1) return ok(s)
  const ax = (axis ?? [0, 0, 0]) as Vec3
  if (vecIsZero(ax)) {
    return err(validationError('PATTERN_ZERO_AXIS', 'Pattern axis cannot be zero'))
  }
  const angleStep = (fullAngle === undefined ? 360 : Number(fullAngle)) / n
  const c = (center ?? [0, 0, 0]) as Vec3
  const copies = kernel.circularPattern(
    s,
    { x: c[0], y: c[1], z: c[2] },
    { x: ax[0], y: ax[1], z: ax[2] },
    angleStep,
    n,
  )
  return ok(fuseReplicas(kernel, copies))
}

// ---------------------------------------------------------------------------
// gridPattern — 二维网格复制（brepjs patternFns.ts#gridPattern）
// ---------------------------------------------------------------------------

/**
 * Grid pattern — 2D grid copies of a shape (brepjs patternFns.ts#gridPattern).
 *
 * @param args - Resolved arguments (shape, directions, counts, spacings).
 * @returns The fused pattern copies as a `BrepHandle`.
 */
export function gridPatternBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, directionX, directionY, countX, countY, spacingX, spacingY] = resolveArgs(args, GRID_PATTERN_PARAMS)
  const kernel = getBrepApi()
  const s = brepHandleOf(shape)
  const nx = Number(countX)
  const ny = Number(countY)
  if (nx < 1 || ny < 1) {
    return err(validationError('PATTERN_INVALID_COUNT', 'Grid pattern counts must be at least 1'))
  }
  if (nx === 1 && ny === 1) return ok(s)
  const dx = (directionX ?? [0, 0, 0]) as Vec3
  const dy = (directionY ?? [0, 0, 0]) as Vec3
  if (vecIsZero(dx)) {
    return err(validationError('PATTERN_ZERO_DIRECTION', 'Grid directionX cannot be zero'))
  }
  if (vecIsZero(dy)) {
    return err(validationError('PATTERN_ZERO_DIRECTION', 'Grid directionY cannot be zero'))
  }
  const nx2 = vecNormalize([dx[0], dx[1], dx[2]])
  const ny2 = vecNormalize([dy[0], dy[1], dy[2]])
  // core gridPattern 已组合复制并 fuse 成单个 compound/solid
  return ok(
    kernel.gridPattern(
      s,
      { x: nx2[0], y: nx2[1], z: nx2[2] },
      { x: ny2[0], y: ny2[1], z: ny2[2] },
      Number(spacingX),
      Number(spacingY),
      nx,
      ny,
    ),
  )
}

// ---------------------------------------------------------------------------
// rectangularPattern — 双向矩形阵列（brepjs compoundOpsFns.ts#rectangularPattern）
// ---------------------------------------------------------------------------

/**
 * Rectangular pattern — two-direction rectangular array
 * (brepjs compoundOpsFns.ts#rectangularPattern).
 *
 * @param args - Resolved arguments (shape, rectangular pattern options).
 * @returns The fused pattern copies as a `BrepHandle`.
 */
export function rectangularPatternBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, options] = resolveArgs(args, RECT_PATTERN_PARAMS)
  const kernel = getBrepApi()
  const s = brepHandleOf(shape)
  const { xDir, xCount, xSpacing, yDir, yCount, ySpacing } = (options ?? {}) as {
    xDir?: Vec3
    xCount?: number
    xSpacing?: number
    yDir?: Vec3
    yCount?: number
    ySpacing?: number
  }
  const xc = Number(xCount ?? 0)
  const yc = Number(yCount ?? 0)
  const xs = Number(xSpacing ?? 0)
  const ys = Number(ySpacing ?? 0)
  if (xc < 1 || yc < 1) {
    return err(validationError('PATTERN_INVALID_COUNT', 'Pattern counts must be at least 1'))
  }
  if (xc === 1 && yc === 1) return ok(s)
  const xd = (xDir ?? [0, 0, 0]) as Vec3
  const yd = (yDir ?? [0, 0, 0]) as Vec3
  if (vecIsZero(xd)) {
    return err(validationError('PATTERN_ZERO_DIRECTION', 'X direction cannot be zero'))
  }
  if (vecIsZero(yd)) {
    return err(validationError('PATTERN_ZERO_DIRECTION', 'Y direction cannot be zero'))
  }
  const xNorm = vecNormalize([xd[0], xd[1], xd[2]])
  const yNorm = vecNormalize([yd[0], yd[1], yd[2]])
  const copies: BrepHandle[] = [s]
  const owned: BrepHandle[] = []
  for (let xi = 0; xi < xc; xi++) {
    for (let yi = 0; yi < yc; yi++) {
      if (xi === 0 && yi === 0) continue
      const offset: Vec3 = [
        xNorm[0] * xs * xi + yNorm[0] * ys * yi,
        xNorm[1] * xs * xi + yNorm[1] * ys * yi,
        xNorm[2] * xs * xi + yNorm[2] * ys * yi,
      ]
      const c = kernel.translate(s, offset[0], offset[1], offset[2])
      copies.push(c)
      owned.push(c)
    }
  }
  const fused = kernel.fuseAll(copies)
  for (const c of owned) kernel.release(c)
  return ok(fused)
}
