/**
 * Self-hosted compat-op implementations — extrude/revolve/sweep family
 * (core-decouple Phase 3, §5.4; G3).
 *
 * @platform occt
 *
 * Semantics mirror brepjs `operations/{api,extrudeFns,sweepFns}.ts`:
 *  - `extrudeBrep` — height: number → [0,0,h]; Vec3 → as-is. EXTRUDE_ZERO_VECTOR guard.
 *  - `revolveBrep` — options { at, axis, angle(radians, default 2π) }; REVOLUTION_NOT_3D.
 *  - `sweepBrep` — config.mode 'simple' → simplePipe; default → sweepPipeShell(frenet).
 *    shellMode / law / auxiliarySpine / support / correction configs are not
 *    supported after core migration (cad 面取手写 api/sweep.ts，shell 元组不暴露 §2.4①).
 *  - `complexExtrudeBrep` / `twistExtrudeBrep` — linear / helix spine built on
 *    occt-wasm makeLineEdge+makeWire / makeHelixWire, then sweepPipeShell.
 *    ExtrusionProfile scaling law is not supported (brepjs buildLawFromProfile
 *    has no L1 equivalent); non-undefined profile → LAW_UNSUPPORTED error.
 */

import type { BrepHandle } from '../../brep/engine/types'
import { getBrepApi } from '../../brep/handle-bridge'
import { ok, err, type Result } from '../../result/result'
import { kernelError, validationError } from '../../result/errors'
import type { FormClass } from '../internal/dual-form-args'
import { resolveArgs } from '../internal/dual-form-args'
import type { Vec3 } from '../geom-types/types'
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

/** 构造直线 spine wire（brepjs makeSpineWire）。 */
function makeSpineWire(kernel: ReturnType<typeof getBrepApi>, start: Vec3, end: Vec3): BrepHandle {
  const e = kernel.makeLineEdge({ x: start[0], y: start[1], z: start[2] }, { x: end[0], y: end[1], z: end[2] })
  const w = kernel.makeWire([e])
  kernel.release(e)
  return w
}

// ---------------------------------------------------------------------------
// extrude — face 沿向量/高度拉伸（brepjs api.js#extrude + extrudeFns.ts#extrude）
// ---------------------------------------------------------------------------

/**
 * Extrude a face along a vector/height (brepjs api.js#extrude + extrudeFns.ts#extrude).
 *
 * @param args - Resolved arguments (face, height or extrusion vector).
 * @returns The extruded solid as a `BrepHandle`.
 */
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
// revolve — face 绕轴旋转（brepjs api.js#revolve；angle 单位弧度，默认 2π）
// ---------------------------------------------------------------------------

/**
 * Revolve a face around an axis (brepjs api.js#revolve; angle in radians, default 2π).
 *
 * @param args - Resolved arguments (face, revolve options).
 * @returns The revolved solid as a `BrepHandle`.
 */
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
// sweep — 截面沿脊柱扫掠（brepjs sweepFns.ts#sweep）
// ---------------------------------------------------------------------------

/**
 * `sweep` 的完整控制面（S3，方案 §3.4.3）：给出下列任一字段即改走 occt 原生
 * `sweepFull`（`sweepAdvanced`/`sweepOriented` 的能力是其子集，由同一选项对象承载）。
 * 未给出任何字段时保持旧路径（`simplePipe` / `sweepPipeShell`）**逐字节不变**。
 */
const SWEEP_FULL_KEYS = [
  'orientation',
  'up',
  'auxSpine',
  'curvilinearEquivalence',
  'guideContact',
  'withContact',
  'withCorrection',
  'support',
  'maxDegree',
  'maxSegments',
  'law',
  'lawLength',
  'lawEndFactor',
  'tol3d',
  'boundTol',
  'tolAngular',
] as const

/** SweepMode 名字 → occt 枚举值（Fixed=0 / Frenet=1 / FixedUp=2 / Auxiliary=3）。 */
const SWEEP_MODE_CODE: Record<string, number> = {
  fixed: 0,
  frenet: 1,
  fixedUp: 2,
  auxiliary: 3,
}
/** TransitionMode 名字 → occt 枚举值（Transformed=0 / RightCorner=1 / RoundCorner=2）。 */
const SWEEP_TRANSITION_CODE: Record<string, number> = {
  transformed: 0,
  rightCorner: 1,
  roundCorner: 2,
}
/** SweepContact 名字 → occt 枚举值（None=0 / Contact=1 / ContactOnBorder=2）。 */
const SWEEP_CONTACT_CODE: Record<string, number> = {
  none: 0,
  contact: 1,
  contactOnBorder: 2,
}
/** SweepLaw 名字 → occt 枚举值（None=0 / Linear=1 / SCurve=2）。 */
const SWEEP_LAW_CODE: Record<string, number> = {
  none: 0,
  linear: 1,
  sCurve: 2,
}

/** sweep 配置（`sweepFns` 侧形态；faijs 面 = api/sweep.ts 的 SweepOptions）。 */
interface SweepConfig {
  mode?: string
  frenet?: boolean
  transitionMode?: string
  [k: string]: unknown
}

/** 是否给出 sweepFull 专有字段（或 transitionMode 的新语义名）。 */
function wantsSweepFull(cfg: SweepConfig): boolean {
  if (SWEEP_FULL_KEYS.some((k) => cfg[k] !== undefined)) return true
  return cfg.transitionMode !== undefined && SWEEP_TRANSITION_CODE[cfg.transitionMode] !== undefined
}

/** 选项对象 → occt sweepFull 的 options（只放已给出的键，其余走内核缺省）。 */
function toSweepFullOptions(
  cfg: SweepConfig,
): Result<Record<string, unknown>, ReturnType<typeof validationError>> {
  const opts: Record<string, unknown> = {}
  const pickEnum = (key: string, field: string, table: Record<string, number>): void => {
    const v = cfg[key]
    if (v === undefined) return
    const code = table[String(v)]
    if (code === undefined) {
      throw validationError(
        `E_SWEEP_BAD_${field.toUpperCase()}`,
        `sweep ${field} '${String(v)}' is invalid (allowed: ${Object.keys(table).join(' / ')})`,
      )
    }
    opts[field === 'orientation' ? 'mode' : field] = code
  }
  try {
    pickEnum('orientation', 'orientation', SWEEP_MODE_CODE)
    const transition = cfg['transitionMode']
    if (transition !== undefined) {
      // 只要走到这里（wantsSweepFull 为真），transitionMode 必是新语义名之一。
      opts.transitionMode = SWEEP_TRANSITION_CODE[transition]
    }
    pickEnum('guideContact', 'guideContact', SWEEP_CONTACT_CODE)
    pickEnum('law', 'law', SWEEP_LAW_CODE)

    const up = cfg['up'] as readonly number[] | undefined
    if (up !== undefined) {
      if (!Array.isArray(up) || up.length !== 3) {
        throw validationError('E_SWEEP_BAD_UP', 'sweep up must be [x,y,z]')
      }
      opts.up = { x: up[0], y: up[1], z: up[2] }
    }
    const auxSpine = cfg['auxSpine']
    if (auxSpine !== undefined) opts.auxSpine = brepHandleOf(auxSpine)
    const support = cfg['support']
    if (support !== undefined) opts.support = brepHandleOf(support)
    for (const k of ['curvilinearEquivalence', 'withContact', 'withCorrection'] as const) {
      if (cfg[k] !== undefined) opts[k] = cfg[k]
    }
    for (const k of ['maxDegree', 'maxSegments', 'lawLength', 'lawEndFactor', 'tol3d', 'boundTol', 'tolAngular'] as const) {
      if (cfg[k] !== undefined) opts[k] = cfg[k]
    }
    // 内核硬前置：law 非 none 时 lawLength 必给（occt-wasm 自己也会抛；此处前置给清楚的错误码）。
    const lawCode = opts.law as number | undefined
    if (lawCode !== undefined && lawCode !== SWEEP_LAW_CODE.none && opts.lawLength === undefined) {
      throw validationError(
        'E_SWEEP_LAW_NEEDS_LENGTH',
        'sweep law requires lawLength (the spine length the law spans)',
      )
    }
    return ok(opts)
  } catch (e) {
    return err(e as ReturnType<typeof validationError>)
  }
}

/**
 * Sweep a profile along a spine (brepjs sweepFns.ts#sweep).
 *
 * 两条路径（S3）：
 * - 无 sweepFull 专有字段 → 旧路径（`mode:'simple'` → `simplePipe`；否则 `sweepPipeShell`）；
 * - 给出任一 sweepFull 字段 → occt 原生 `sweepFull`（完整控制面：朝向模式 / 转角过渡 /
 *   引导线关系 / 支持面 / 逼近预算 / 缩放律）。`mode:'simple'` 与 sweepFull 字段互斥。
 *
 * @param args - Resolved arguments (wire, spine, config, shellMode).
 * @returns The swept solid as a `BrepHandle`.
 */
export function sweepBrep(...args: unknown[]): Result<BrepHandle> {
  const [wire, spine, config, shellMode] = resolveArgs(args, SWEEP_PARAMS)
  const w = brepHandleOf(wire)
  const sp = brepHandleOf(spine)
  const cfg = (config ?? {}) as SweepConfig
  if (shellMode === true) {
    return err(
      validationError(
        'SWEEP_SHELL_MODE_UNSUPPORTED',
        'sweep shellMode is not supported after core migration (cad 面不暴露壳元组 §2.4①)',
      ),
    )
  }
  const useFull = wantsSweepFull(cfg)
  if (!useFull && cfg.transitionMode !== undefined && cfg.transitionMode !== 'right') {
    return err(
      validationError(
        'E_SWEEP_TRANSITION_UNSUPPORTED',
        `sweep transitionMode '${cfg.transitionMode}' is not supported (allowed: 'right' legacy alias, or 'transformed' / 'rightCorner' / 'roundCorner')`,
      ),
    )
  }
  if (useFull && cfg.mode === 'simple') {
    return err(
      validationError(
        'E_SWEEP_MODE_CONFLICT',
        "sweep mode:'simple' cannot be combined with sweepFull options (orientation / law / transition / support / auxSpine / tolerances)",
      ),
    )
  }
  try {
    if (useFull) {
      const built = toSweepFullOptions(cfg)
      if (!built.ok) return err(built.error)
      return ok(getOcctKernel().sweepFull(w as never, sp as never, built.value as never) as unknown as BrepHandle)
    }
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
// complexExtrude — wire 沿 normal 挤出（brepjs sweepFns.ts#complexExtrude）
// ---------------------------------------------------------------------------

/**
 * Extrude a wire along a normal (brepjs sweepFns.ts#complexExtrude).
 *
 * @param args - Resolved arguments (wire, center, normal, profile).
 * @returns The extruded solid as a `BrepHandle`.
 */
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
        'complexExtrude ExtrusionProfile scaling law is not supported after core migration',
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
// twistExtrude — wire 沿螺旋挤出（brepjs sweepFns.ts#twistExtrude）
// ---------------------------------------------------------------------------

/**
 * Extrude a wire along a helical path (brepjs sweepFns.ts#twistExtrude).
 *
 * @param args - Resolved arguments (wire, angleDegrees, center, normal, profile).
 * @returns The twisted extrusion as a `BrepHandle`.
 */
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
        'twistExtrude negative angle (left-handed helix) is not supported after core migration (occt-wasm makeHelixWire has no handedness param)',
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
        'twistExtrude ExtrusionProfile scaling law is not supported after core migration',
      ),
    )
  }
  const extrusionLength = vecLength(n)
  const pitch = (360.0 / Math.abs(angle)) * extrusionLength
  // brepjs 语义：主 spine=直线、auxiliary=helix，sweepPipeShell 传对象参数
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
