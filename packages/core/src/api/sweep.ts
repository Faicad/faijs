/**
 * api sweep — 扫掠：截面沿脊柱路径生成扫掠体（手写平台 op，Phase 4 → G5 core 直连）
 *
 * @platform occt — 实现走 core 自有 `brep-operations/sweepFns.ts#sweepBrep`
 * （occt-wasm simplePipe / sweepPipeShell；engine-method-map 里 `sweep` 为
 * occt-only）⇒ 平台 op：defineOp 声明 `engines: ['occt']`（D11）。
 *
 * 为什么手写而不走生成投影：与 `api/loft.ts` 同因——截面最常见来源是
 * `cad.profile(...)`（产出 **face**），需「面 → 外环」输入适配
 * （`internal/profile-wire.ts` 的唯一步径）。脊柱容忍 face（FCStd 翻译把
 * 脊柱基对象 sketch 整圈外廓当路径）。
 *
 * core-decouple G5：旧 `sweep`（brepjs）替换为 brep-operations 自有实现直连，
 * 产物经 `fromBrep` 收养（替代 l3-bridge adoptEntity）。
 */

import type { Shape } from '../mesh/types'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep } from '../shape'
import { solidToShape } from '../brep/brep-ops'
import { sweepBrep as coreSweep } from './brep-operations/sweepFns'
import { toProfileWireView } from './internal/profile-wire'
import { unwrapResult } from './internal/result-unwrap'
import type { BrepHandle } from '../brep/engine/types'

/** sweep 的截面朝向模式（映射 occt `SweepMode`）。 */
export type SweepOrientation = 'fixed' | 'frenet' | 'fixedUp' | 'auxiliary'
/** sweep 的引导线接触关系（映射 occt `SweepContact`，仅 `orientation:'auxiliary'` 有效）。 */
export type SweepGuideContact = 'none' | 'contact' | 'contactOnBorder'
/** sweep 沿脊柱的缩放律（映射 occt `SweepLaw`；`law ≠ 'none'` 时必须给 `lawLength`）。 */
export type SweepLawKind = 'none' | 'linear' | 'sCurve'

/**
 * 扫掠配置。
 *
 * 两条路径（S3，方案 §3.4.3「扩 sweep」）：
 * - **旧路径**（默认）：只给 `frenet` / `mode` / `tolerance` / `transitionMode:'right'` 时，
 *   走 `sweepPipeShell`（`mode:'simple'` → `simplePipe`），行为与 S3 前逐字节一致；
 * - **完整控制面**：给出下列任一 sweepFull 字段时改走 occt 原生 `sweepFull`
 *   （occt-wasm 的 `sweepAdvanced` / `sweepOriented` 是其子集，由同一选项对象承载）。
 */
export interface SweepOptions {
  /** Frenet 参考系（默认 false）。仅旧路径。 */
  frenet?: boolean
  /** 扫掠模式：'simple'（MakePipe）或 undefined（PipeShell）。与 sweepFull 字段互斥。 */
  mode?: 'simple'
  /**
   * 转角过渡模式：`'right'`（旧别名，等价于内核缺省 Transformed）或
   * `'transformed'` / `'rightCorner'` / `'roundCorner'`（后三者走 sweepFull）。
   */
  transitionMode?: 'right' | 'transformed' | 'rightCorner' | 'roundCorner'
  /** 公差等其余旧字段（保留以兼容调用方）。 */
  tolerance?: number

  // ── sweepFull 控制面（S3）──
  /** 截面朝向模式（默认内核缺省 Fixed）。 */
  orientation?: SweepOrientation
  /** `orientation:'fixedUp'` 的恒定 binormal 方向（默认 +Z）。 */
  up?: [number, number, number]
  /** `orientation:'auxiliary'` 的引导线（Shape）。 */
  auxSpine?: Shape
  /** `orientation:'auxiliary'`：按弧长而非参数匹配脊柱与引导线（默认 false）。 */
  curvilinearEquivalence?: boolean
  /** `orientation:'auxiliary'`：截面与引导线的关系（默认 'none'）。 */
  guideContact?: SweepGuideContact
  /** 支持面（含 spine 的 shape）；给出后取代 `orientation`。 */
  support?: Shape
  /** 逼近面的最大阶数（缺省 = 内核缺省）。 */
  maxDegree?: number
  /** 最大段数（缺省 = 内核缺省）。 */
  maxSegments?: number
  /** 沿脊柱的缩放律（默认 'none'）。 */
  law?: SweepLawKind
  /** law 跨越的参数长度（= 脊柱长度）；`law ≠ 'none'` 时必给。 */
  lawLength?: number
  /** law 末端的截面缩放（1 = 不缩放）。 */
  lawEndFactor?: number
  /** 3D 逼近公差（绝对量，缺省 = 内核缺省 1e-4）。 */
  tol3d?: number
  /** 边界公差（绝对量）。 */
  boundTol?: number
  /** 角度公差（弧度）。 */
  tolAngular?: number
}

/** BREP 路径：截面沿脊柱扫掠（wire 视图 → brep-operations 直连 → fromBrep 收养）。 */
function sweepBrep(profile: Shape, spine: Shape, opts?: SweepOptions): Shape {
  if (!profile) throw new Error('E_SWEEP_NO_PROFILE: sweep requires a profile (section) shape')
  if (!spine) throw new Error('E_SWEEP_NO_SPINE: sweep requires a spine (path) shape')
  // 截面 / 脊柱：wire 直用；面取外环（孔环不参与扫掠）。
  const profileWire = toProfileWireView(profile)
  const spineWire = toProfileWireView(spine)
  const r = coreSweep(profileWire, spineWire, opts ?? {}, false)
  const h = unwrapResult(r, 'sweep') as BrepHandle
  const kernel = getBrepApi()
  try {
    return fromBrep(solidToShape(kernel, h), { solid: h })
  } finally {
    // 面→外环产出的 wire 是 arena 新句柄（曲线借用不 release）
    if (!profileWire.borrowed) {
      try { kernel.release(profileWire.wrapped) } catch { /* 已释放 */ }
    }
    if (!spineWire.borrowed) {
      try { kernel.release(spineWire.wrapped) } catch { /* 已释放 */ }
    }
  }
}

/**
 * 扫掠：截面沿脊柱路径生成扫掠体。
 * @group 特征
 * @inputs 2
 * @async true
 * @qual ok
 * @name sweep
 * @note 平台 op：仅 occt 引擎（BRepOffsetAPI_MakePipeShell / MakePipe）。截面接受
 *       wire 或面（面取其外环）；脊柱必须为 wire。非 occt 引擎执行前报错；
 *       brep_mock 不拦截。`shellMode` 不暴露（元组产物跨不过单产物边界）。
 *       S3 完整控制面（方案 §3.4.3）：给出 `orientation` / `up` / `auxSpine` /
 *       `curvilinearEquivalence` / `guideContact` / `transitionMode`（新名）/
 *       `support` / `maxDegree` / `maxSegments` / `law` / `lawLength` /
 *       `lawEndFactor` / `tol3d` / `boundTol` / `tolAngular` 任一，即改走 occt 原生
 *       `sweepFull`（law 驱动扫掠是 twist 类特征的正确路径）。
 * @returns Shape 扫掠体。
 * @param profile - 截面几何（wire 或面；面取其外环）。type:Shape required:true
 * @param spine - 脊柱路径（wire）。type:Shape required:true
 * @param opts - 扫掠配置（旧字段 + sweepFull 完整控制面）。type:SweepOptions required:false
 * @example
 * const path = cad.wire([[0, 0, 0], [0, 0, 50]])
 * const section = cad.profile({ contours: [{ segments: [
 *   { kind: 'line', x1: -4, y1: -4, x2: 4, y2: -4 },
 *   { kind: 'line', x1: 4, y1: -4, x2: 4, y2: 4 },
 *   { kind: 'line', x1: 4, y1: 4, x2: -4, y2: 4 },
 *   { kind: 'line', x1: -4, y1: 4, x2: -4, y2: -4 },
 * ] }] })
 * const body = await cad.sweep(section, path)
 */
export const sweep = defineOp({
  name: 'sweep',
  brep(profile: Shape, spine: Shape, opts?: SweepOptions) {
    return sweepBrep(profile, spine, opts)
  },
  engines: ['occt'],
  naming: { kind: 'unmodeled', reason: 'swept-body face vocabulary not defined' } as Provenance,
})
