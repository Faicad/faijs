/**
 * Self-hosted compat-op implementations — topology transform family
 * (core-decouple Phase 3, §5.4).
 *
 * @platform occt
 *
 * Each export is a "brep-shaped" implementation consumed by the generated
 * compat-op projection (defineOp + D11 arg normalization). Inputs are the
 * normalized positional arguments of the op's params table; shapes arrive as
 * faijs Shapes (or raw handles) and results are returned as BREP handles
 * (wrapped by `wrapBrepOne` → `fromHandle`).
 *
 * Semantics mirror the vendored brepjs fns (`topology/transformFns.ts`,
 * `topology/shapeFns.ts`) with the brepjs object model (castResultShape,
 * metadata propagation, evolution tracking) dropped: occt-wasm handles only.
 */

import type { BrepHandle } from '../../brep/engine/types'
import { getBrepApi } from '../../brep/handle-bridge'
import { ok, err, type Result } from '../../result/result'
import { kernelError, validationError } from '../../result/errors'
import type { FormClass } from '../internal/dual-form-args'
import { resolveArgs } from '../internal/dual-form-args'
import type { MatrixInput, Vec3 } from '../brepjs-compat/types'
import { brepHandleOf, composeAffine, IDENTITY_3X4, rotationMatrix, translationMatrix } from './brepHelpers'
import { getOcctKernel } from '../../occt-kernel/occtKernel'

const VALIDATION_FAILED = 'VALIDATION_FAILED'

// ---------------------------------------------------------------------------
// Matrix input parsing (vendored `parseMatrixInput` / `det3x3`)
// ---------------------------------------------------------------------------

type Linear3x3 = readonly [number, number, number, number, number, number, number, number, number]

function parseMatrixInput(
  input: MatrixInput,
): Result<{ linear: Linear3x3; translation: readonly [number, number, number] }> {
  if ('linear' in input) {
    return ok({ linear: input.linear, translation: input.translation })
  }
  const [r0, r1, r2, r3] = input
  const TOL = 1e-10
  if (Math.abs(r3[0]) > TOL || Math.abs(r3[1]) > TOL || Math.abs(r3[2]) > TOL || Math.abs(r3[3] - 1) > TOL) {
    return err(
      validationError(
        VALIDATION_FAILED,
        `applyMatrix: invalid bottom row [${String(r3[0])}, ${String(r3[1])}, ${String(r3[2])}, ${String(r3[3])}]. Must be [0, 0, 0, 1] for an affine transform.`,
      ),
    )
  }
  return ok({
    linear: [r0[0], r0[1], r0[2], r1[0], r1[1], r1[2], r2[0], r2[1], r2[2]],
    translation: [r0[3], r1[3], r2[3]],
  })
}

function det3x3(m: Linear3x3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  )
}

// ---------------------------------------------------------------------------
// applyMatrix
// ---------------------------------------------------------------------------

const APPLY_MATRIX_PARAMS = { name: 'applyMatrix', params: ['shape', 'matrix'], formClass: 'A' as FormClass }

/**
 * Apply a 4×4 affine matrix (OpenSCAD `multmatrix` equivalent).
 *
 * The vendored fn splits orthogonal (evolution-tracked) and non-orthogonal
 * (`gp_GTrsf`) paths; the core path uses the single L1 `generalTransform`
 * (occt-wasm `gp_GTrsf`, geometrically equivalent for both classes) since
 * `applyMatrix` carries identity naming and needs no face evolution.
 *
 * @param args - Resolved arguments (shape, matrix).
 * @returns The transformed shape as a `BrepHandle`.
 */
export function applyMatrixBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, matrix] = resolveArgs(args, APPLY_MATRIX_PARAMS)
  const parsed = parseMatrixInput(matrix as MatrixInput)
  if (!parsed.ok) return parsed
  const { linear, translation } = parsed.value
  if (Math.abs(det3x3(linear)) < 1e-12) {
    return err(
      validationError(
        VALIDATION_FAILED,
        'applyMatrix: singular matrix (determinant ≈0). Cannot apply a non-invertible transform.',
      ),
    )
  }
  const kernel = getBrepApi()
  try {
    const m12 = [
      linear[0], linear[1], linear[2], translation[0],
      linear[3], linear[4], linear[5], translation[1],
      linear[6], linear[7], linear[8], translation[2],
    ]
    // GOTCHA (2026-09-25): occt-wasm's `located`/`generalTransform` return
    // TopLoc/GTrsf-referencing handles whose STEP export crashes
    // ("memory access out of bounds") — only the affine `transform`
    // (BRepBuilderAPI_Transform, deep-copy) is STEP-safe. A similar
    // transform (orthogonal rows, equal lengths) is affine and goes
    // through `transform`; genuinely non-affine matrices keep the
    // generalTransform path (no current caller, pre-existing behavior).
    const lin = linear as readonly [number, number, number, number, number, number, number, number, number]
    const s0 = Math.hypot(lin[0], lin[1], lin[2])
    const s1 = Math.hypot(lin[3], lin[4], lin[5])
    const s2 = Math.hypot(lin[6], lin[7], lin[8])
    const dot01 = Math.abs(lin[0] * lin[3] + lin[1] * lin[4] + lin[2] * lin[5])
    const dot02 = Math.abs(lin[0] * lin[6] + lin[1] * lin[7] + lin[2] * lin[8])
    const dot12 = Math.abs(lin[3] * lin[6] + lin[4] * lin[7] + lin[5] * lin[8])
    const TOL = 1e-9
    const similar =
      s0 > TOL && Math.abs(s1 - s0) < TOL && Math.abs(s2 - s0) < TOL &&
      dot01 < TOL && dot02 < TOL && dot12 < TOL
    return ok(similar ? kernel.transform(brepHandleOf(shape), m12) : kernel.generalTransform(brepHandleOf(shape), m12))
  } catch (e) {
    return err(
      kernelError(
        'APPLY_MATRIX_FAILED',
        `applyMatrix: kernel transform failed: ${e instanceof Error ? e.message : String(e)}`,
        e,
      ),
    )
  }
}

// ---------------------------------------------------------------------------
// clone
// ---------------------------------------------------------------------------

const CLONE_PARAMS = { name: 'clone', params: ['shape'], formClass: 'A' as FormClass }

/**
 * Deep-copy a shape (`kernel.copyShape`).
 *
 * @param args - Resolved arguments (shape).
 * @returns The cloned shape as a `BrepHandle`.
 */
export function cloneBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape] = resolveArgs(args, CLONE_PARAMS)
  const kernel = getBrepApi()
  try {
    return ok(kernel.copyShape(brepHandleOf(shape)))
  } catch (e) {
    return err(
      kernelError(
        'CLONE_FAILED',
        `clone: kernel copy failed: ${e instanceof Error ? e.message : String(e)}`,
        e,
      ),
    )
  }
}

// ---------------------------------------------------------------------------
// locate
// ---------------------------------------------------------------------------

const LOCATE_PARAMS = { name: 'locate', params: ['shape', 'placement'], formClass: 'A' as FormClass }

type TransformOp =
  | { readonly type: 'translate'; readonly v: Vec3 }
  | { readonly type: 'rotate'; readonly angle: number; readonly axis?: Vec3; readonly center?: Vec3 }

function opToMatrix(op: TransformOp): number[] {
  if (op.type === 'translate') return translationMatrix(op.v)
  const axis = op.axis ?? [0, 0, 1]
  const center = op.center ?? [0, 0, 0]
  return rotationMatrix(axis as Vec3, center as Vec3, op.angle)
}

/**
 * Placement-only rigid move (translate/rotate) via the kernel's cheap location
 * re-tag. Ops apply first-to-last (rotate then translate).
 *
 * @param args - Resolved arguments (shape, placement).
 * @returns The relocated shape as a `BrepHandle`.
 */
export function locateBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, placement] = resolveArgs(args, LOCATE_PARAMS)
  const ops: readonly TransformOp[] =
    placement !== null && typeof placement === 'object' && 'type' in (placement as object)
      ? [placement as TransformOp]
      : (placement as readonly TransformOp[])
  const kernel = getBrepApi()
  try {
    let acc: number[] = [...IDENTITY_3X4]
    for (const op of ops) acc = composeAffine(acc, opToMatrix(op))
    return ok(kernel.locate(brepHandleOf(shape), acc))
  } catch (e) {
    return err(
      kernelError(
        'LOCATE_FAILED',
        `locate: kernel locate failed: ${e instanceof Error ? e.message : String(e)}`,
        e,
      ),
    )
  }
}

// ---------------------------------------------------------------------------
// mirror
// ---------------------------------------------------------------------------

const MIRROR_PARAMS = { name: 'mirror', params: ['shape', 'options'], formClass: 'A' as FormClass }

/**
 * Mirror across a plane defined by `options.at` (origin) and `options.normal`.
 *
 * @param args - Resolved arguments (shape, mirror options).
 * @returns The mirrored shape as a `BrepHandle`.
 */
export function mirrorBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, options] = resolveArgs(args, MIRROR_PARAMS)
  const opts = (options ?? {}) as { normal?: Vec3; at?: Vec3 }
  const normal = opts.normal ?? [1, 0, 0]
  const at = opts.at ?? [0, 0, 0]
  const kernel = getBrepApi()
  try {
    return ok(kernel.mirror(brepHandleOf(shape), { x: at[0], y: at[1], z: at[2] }, { x: normal[0], y: normal[1], z: normal[2] }))
  } catch (e) {
    return err(
      kernelError(
        'MIRROR_FAILED',
        `mirror: kernel mirror failed: ${e instanceof Error ? e.message : String(e)}`,
        e,
      ),
    )
  }
}


// ---------------------------------------------------------------------------
// rotate — 绕轴旋转（vendored topology/api.js#rotate + transformFns.ts#rotate）// ---------------------------------------------------------------------------

const ROTATE_PARAMS = { name: 'rotate', params: ['shape', 'angle', 'options'], formClass: 'A' as FormClass }

/**
 * Rotate the shape around an axis (vendored topology/api.js#rotate + transformFns.ts#rotate).
 *
 * @param args - Resolved arguments (shape, angle in degrees, axis options).
 * @returns The rotated shape as a `BrepHandle`.
 */
export function rotateBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, angle, options] = resolveArgs(args, ROTATE_PARAMS)
  const s = brepHandleOf(shape)
  const { at = [0, 0, 0], axis = [0, 0, 1] } = (options ?? {}) as { at?: Vec3; axis?: Vec3 }
  try {
    // GOTCHA (2026-09-25): occt-wasm's native `rotate` returns a handle whose
    // STEP export crashes ("memory access out of bounds") — same family as
    // located/generalTransform. Rotation is affine, so build the Rodrigues
    // matrix and go through the STEP-safe `transform` (BRepBuilderAPI_Transform).
    // 2026-09-26: switched from getOcctKernel().transform to the L1 getBrepApi().transform
    // so the op is engine-neutral (brepkit transform = cloneAndTransform deep-copy,
    // same STEP-safe semantics) — see brepkit-batchA-fix.
    const [ax, ay, az] = axis as readonly [number, number, number]
    const alen = Math.hypot(ax, ay, az)
    if (alen < 1e-12) {
      return err(validationError('INVALID_AXIS', `rotate: axis must be non-zero, got [${ax}, ${ay}, ${az}]`))
    }
    const nx = ax / alen, ny = ay / alen, nz = az / alen
    const theta = (Number(angle) * Math.PI) / 180
    const c = Math.cos(theta), sTheta = Math.sin(theta), t = 1 - c
    // R = cI + sK + t·(n⊗n) (Rodrigues)
    const r00 = t * nx * nx + c,     r01 = t * nx * ny - nz * sTheta, r02 = t * nx * nz + ny * sTheta
    const r10 = t * nx * ny + nz * sTheta, r11 = t * ny * ny + c,     r12 = t * ny * nz - nx * sTheta
    const r20 = t * nx * nz - ny * sTheta, r21 = t * ny * nz + nx * sTheta, r22 = t * nz * nz + c
    const [px, py, pz] = at as readonly [number, number, number]
    // Pivot-preserving translation: p' = R·(p − at) + at  ⇒  tx = at − R·at
    const tx = px - (r00 * px + r01 * py + r02 * pz)
    const ty = py - (r10 * px + r11 * py + r12 * pz)
    const tz = pz - (r20 * px + r21 * py + r22 * pz)
    const m12 = [r00, r01, r02, tx, r10, r11, r12, ty, r20, r21, r22, tz]
    return ok(getBrepApi().transform(s, m12))
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(kernelError('ROTATE_FAILED', `Rotate operation failed: ${raw}`, e))
  }
}

// ---------------------------------------------------------------------------
// shell — 去面掏空（vendored topology/api.js#shell + modifierFns.ts#shell）// ---------------------------------------------------------------------------

const SHELL_PARAMS = { name: 'shell', params: ['shape', 'faces', 'thickness', 'options'], formClass: 'A' as FormClass }

/**
 * Shell — hollow the shape by removing faces (vendored topology/api.js#shell + modifierFns.ts#shell).
 *
 * @param args - Resolved arguments (shape, faces, thickness, options).
 * @returns The shelled (hollowed) shape as a `BrepHandle`.
 */
export function shellBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, faces, thickness, options] = resolveArgs(args, SHELL_PARAMS)
  const kernel = getBrepApi()
  const s = brepHandleOf(shape)
  const t = Number(thickness)
  if (t <= 0) {
    return err(validationError('INVALID_THICKNESS', 'Shell thickness must be positive'))
  }
  if (!Array.isArray(faces) || faces.length === 0) {
    return err(validationError('NO_FACES', 'At least one face must be specified for shell'))
  }
  const faceHandles = (faces as unknown[]).map((f) => brepHandleOf(f))
  const tolerance = ((options ?? {}) as { tolerance?: number }).tolerance ?? 1e-3
  try {
    return ok(kernel.shell(s, faceHandles, t, tolerance))
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(kernelError('SHELL_FAILED', `Shell operation failed: ${raw}`, e))
  }
}

// ---------------------------------------------------------------------------
// offset — 全表面偏移（vendored topology/api.js#offset + modifierFns.ts#offset）// ---------------------------------------------------------------------------

const OFFSET_PARAMS = { name: 'offset', params: ['shape', 'distance', 'options'], formClass: 'A' as FormClass }

/**
 * Offset all faces of the shape (vendored topology/api.js#offset + modifierFns.ts#offset).
 *
 * @param args - Resolved arguments (shape, distance, options).
 * @returns The offset shape as a `BrepHandle`.
 */
export function offsetBrep(...args: unknown[]): Result<BrepHandle> {
  const [shape, distance, options] = resolveArgs(args, OFFSET_PARAMS)
  const s = brepHandleOf(shape)
  const d = Number(distance)
  if (Math.abs(d) < 1e-10) {
    return err(validationError('ZERO_OFFSET', 'Offset distance cannot be zero'))
  }
  const tolerance = ((options ?? {}) as { tolerance?: number }).tolerance ?? 1e-6
  try {
    const h = getOcctKernel().offset(s as never, d, tolerance)
    return ok(h as unknown as BrepHandle)
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(kernelError('OFFSET_FAILED', `Offset operation failed: ${raw}`, e))
  }
}
