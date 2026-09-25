/**
 * Self-hosted compat-op implementations — extrude/revolve/sweep family
 * (core-decouple Phase 3, §5.4; G3).
 *
 * @platform occt
 *
 * Semantics mirror vendored `operations/{api,extrudeFns,sweepFns}.ts`:
 *  - `extrudeBrep` — height: number → [0,0,h]; Vec3 → as-is. EXTRUDE_ZERO_VECTOR guard.
 *  - `revolveBrep` — options { at, axis, angle(radians, default 2π) }; REVOLUTION_NOT_3D.
 *  - `sweepBrep` — config.mode 'simple' → simplePipe; default → sweepPipeShell(frenet).
 *    shellMode / law / auxiliarySpine / support / correction configs are not
 *    supported after selfhosting (cad 面取手写 api/sweep.ts，shell 元组不暴露 §2.4①).
 *  - `complexExtrudeBrep` / `twistExtrudeBrep` — linear / helix spine built on
 *    occt-wasm makeLineEdge+makeWire / makeHelixWire, then sweepPipeShell.
 *    ExtrusionProfile scaling law is not supported (vendored buildLawFromProfile
 *    has no L1 equivalent); non-undefined profile → LAW_UNSUPPORTED error.
 */

import type { BrepHandle } from '../../brep/engine/types'
import { getBrepApi } from '../../brep/handle-bridge'
import { ok, err, type Result } from '../../result/result'
import { kernelError, validationError } from '../../result/errors'
import type { FormClass } from '../internal/dual-form-args'
import { resolveArgs } from '../internal/dual-form-args'
import type { Vec3 } from '../brepjs-compat/types'
import { brepHandleOf } from './brepHelpers'
import { getOcctKernel } from '../../occt-kernel/occtKernel'

const EXTRUDE_PARAMS = { name: 'extrude', params: ['face', 'height'], formClass: 'A' as FormClass }
const REVOLVE_PARAMS = { name: 'revolve', params: ['face', 'options'], formClass: 'A' as FormClass }
const SWEEP_PARAMS = { name: 'sweep', params: ['wire', 'spine', 'config', 'shellMode'], formClass: 'A' as FormClass }
const COMPLEX_EXTRUDE_PARAMS = { name: 'complexExtrude', params: ['wire', 'center', 'normal', 'profile'], formClass: 'A' as FormClass }
const TWIST_EXTRUDE_PARAMS = { name: 'twistExtrude', params: ['wire', 'angleDegrees', 'center', 'normal', 'profile'], formClass: 'A' as FormClass }

function vecLength(v: readonly number[]): number {
  return Math.hypot(v[0], v[1], v[2])
}

/** 构造直线 spine wire（vendored makeSpineWire）。 */
function makeSpineWire(kernel: ReturnType<typeof getBrepApi>, start: Vec3, end: Vec3): BrepHandle {
  const e = kernel.makeLineEdge({ x: start[0], y: start[1], z: start[2] }, { x: end[0], y: end[1], z: end[2] })
  const w = kernel.makeWire([e])
  kernel.release(e)
  return w
}

// ---------------------------------------------------------------------------
// extrude — face 沿向量/高度拉伸（vendored api.js#extrude + extrudeFns.ts#extrude）
// ---------------------------------------------------------------------------

export function extrudeBrep(...args: unknown[]): Result<BrepHandle> {
  const [face, height] = resolveArgs(args, EXTRUDE_PARAMS)
  const kernel = getBrepApi()
  const f = brepHandleOf(face)
  const vec: Vec3 = typeof height === 'number' ? [0, 0, height] : (height as Vec3)
  if (vecLength(vec) < 1e-10) {
    return err(validationError('EXTRUDE_ZERO_VECTOR', 'extrude: extrusion vector has zero length'))
  }
  try {
    return ok(kernel.extrude(f, vec[0], vec[1], vec[2]))
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(kernelError('EXTRUDE_FAILED', `Extrusion operation failed: ${raw}`, e))
  }
}

// ---------------------------------------------------------------------------
// revolve — face 绕轴旋转（vendored api.js#revolve；angle 单位弧度，默认 2π）
// ---------------------------------------------------------------------------

export function revolveBrep(...args: unknown[]): Result<BrepHandle> {
  const [face, options] = resolveArgs(args, REVOLVE_PARAMS)
  const kernel = getBrepApi()
  const f = brepHandleOf(face)
  const { at = [0, 0, 0], axis = [0, 0, 1], angle = 2 * Math.PI } = (options ?? {}) as {
    at?: Vec3
    axis?: Vec3
    angle?: number
  }
  try {
    const h = kernel.revolveVec(
      f,
      { x: at[0], y: at[1], z: at[2] },
      { x: axis[0], y: axis[1], z: axis[2] },
      (angle * 180) / Math.PI,
    )
    return ok(h)
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(kernelError('REVOLVE_FAILED', `Revolution operation failed: ${raw}`, e))
  }
}

// ---------------------------------------------------------------------------
// sweep — 截面沿脊柱扫掠（vendored sweepFns.ts#sweep）
// ---------------------------------------------------------------------------

export function sweepBrep(...args: unknown[]): Result<BrepHandle> {
  const [wire, spine, config, shellMode] = resolveArgs(args, SWEEP_PARAMS)
  const kernel = getBrepApi()
  const w = brepHandleOf(wire)
  const sp = brepHandleOf(spine)
  const cfg = (config ?? {}) as { mode?: string; frenet?: boolean; transitionMode?: string }
  if (shellMode === true) {
    return err(
      validationError(
        'SWEEP_SHELL_MODE_UNSUPPORTED',
        'sweep shellMode is not supported after selfhosting (cad 面不暴露壳元组 §2.4①)',
      ),
    )
  }
  if (cfg.transitionMode !== undefined && cfg.transitionMode !== 'right') {
    return err(
      validationError(
        'SWEEP_TRANSITION_UNSUPPORTED',
        `sweep transitionMode '${cfg.transitionMode}' is not supported after selfhosting (only 'right' default)`,
      ),
    )
  }
  try {
    if (cfg.mode === 'simple') {
      return ok(getOcctKernel().simplePipe(w as never, sp as never) as unknown as BrepHandle)
    }
    return ok(getOcctKernel().sweepPipeShell(w as never, sp as never, cfg.frenet === true, false) as unknown as BrepHandle)
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(kernelError('SWEEP_FAILED', `Sweep operation failed: ${raw}`, e))
  }
}

// ---------------------------------------------------------------------------
// complexExtrude — wire 沿 normal 挤出（vendored sweepFns.ts#complexExtrude）
// ---------------------------------------------------------------------------

export function complexExtrudeBrep(...args: unknown[]): Result<BrepHandle> {
  const [wire, center, normal, profile] = resolveArgs(args, COMPLEX_EXTRUDE_PARAMS)
  const kernel = getBrepApi()
  const w = brepHandleOf(wire)
  const c = (center ?? [0, 0, 0]) as Vec3
  const n = (normal ?? [0, 0, 0]) as Vec3

  if (vecLength(n) < 1e-10) {
    return err(validationError('ZERO_LENGTH_EXTRUSION', 'Extrusion vector cannot have zero length'))
  }
  if (profile !== undefined && profile !== null) {
    return err(
      validationError(
        'COMPLEX_EXTRUDE_LAW_UNSUPPORTED',
        'complexExtrude ExtrusionProfile scaling law is not supported after selfhosting',
      ),
    )
  }
  const endPoint: Vec3 = [c[0] + n[0], c[1] + n[1], c[2] + n[2]]
  const spine = makeSpineWire(kernel, c, endPoint)
  try {
    const h = getOcctKernel().sweepPipeShell(w as never, spine as never, false, false) as unknown as BrepHandle
    return ok(h)
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(kernelError('SWEEP_FAILED', `complexExtrude sweep failed: ${raw}`, e))
  } finally {
    kernel.release(spine)
  }
}

// ---------------------------------------------------------------------------
// twistExtrude — wire 沿螺旋挤出（vendored sweepFns.ts#twistExtrude）
// ---------------------------------------------------------------------------

export function twistExtrudeBrep(...args: unknown[]): Result<BrepHandle> {
  const [wire, angleDegrees, center, normal, profile] = resolveArgs(args, TWIST_EXTRUDE_PARAMS)
  const kernel = getBrepApi()
  const w = brepHandleOf(wire)
  const angle = Number(angleDegrees)
  const c = (center ?? [0, 0, 0]) as Vec3
  const n = (normal ?? [0, 0, 0]) as Vec3

  if (Math.abs(angle) < 1e-10) {
    return err(validationError('ZERO_TWIST_ANGLE', 'Twist angle cannot be zero'))
  }
  if (angle < 0) {
    return err(
      validationError(
        'TWIST_NEGATIVE_ANGLE_UNSUPPORTED',
        'twistExtrude negative angle (left-handed helix) is not supported after selfhosting (occt-wasm makeHelixWire has no handedness param)',
      ),
    )
  }
  if (vecLength(n) < 1e-10) {
    return err(validationError('ZERO_LENGTH_EXTRUSION', 'Extrusion vector cannot have zero length'))
  }
  if (profile !== undefined && profile !== null) {
    return err(
      validationError(
        'TWIST_EXTRUDE_LAW_UNSUPPORTED',
        'twistExtrude ExtrusionProfile scaling law is not supported after selfhosting',
      ),
    )
  }
  const extrusionLength = vecLength(n)
  const pitch = (360.0 / Math.abs(angle)) * extrusionLength
  // vendored 语义：主 spine=直线、auxiliary=helix，sweepPipeShell 传对象参数
  // （occt-wasm 运行时接受 auxiliary 键；d.ts 窄签名用 as never 绕过）
  const endPointTwist: Vec3 = [c[0] + n[0], c[1] + n[1], c[2] + n[2]]
  const spine = makeSpineWire(kernel, c, endPointTwist)
  const axisDir = vecLength(n) > 1e-12 ? [n[0] / vecLength(n), n[1] / vecLength(n), n[2] / vecLength(n)] : [0, 0, 1]
  try {
    const helix = getOcctKernel().makeHelixWire(
      { x: c[0], y: c[1], z: c[2] },
      { x: axisDir[0], y: axisDir[1], z: axisDir[2] },
      pitch,
      extrusionLength,
      1,
    )
    const h = getOcctKernel().sweepPipeShell(w as never, spine as never, { auxiliary: helix } as never) as unknown as BrepHandle
    getOcctKernel().release(helix as never)
    kernel.release(spine)
    return ok(h)
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    return err(kernelError('SWEEP_FAILED', `twistExtrude sweep failed: ${raw}`, e))
  }
}
