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

/** 扫掠配置（与旧 SweepOptions 同形；本文件自持，去外部依赖）。 */
export interface SweepOptions {
  /** Frenet 参考系（默认 false）。 */
  frenet?: boolean
  /** 扫掠模式：'simple'（MakePipe）或 undefined（PipeShell）。 */
  mode?: 'simple'
  /** 过渡模式：仅支持默认 'right'（core 实现限制，见 sweepFns）。 */
  transitionMode?: string
  /** 公差等其余旧字段（保留以兼容调用方）。 */
  tolerance?: number
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
 * @returns Shape 扫掠体。
 * @param profile - 截面几何（wire 或面；面取其外环）。type:Shape required:true
 * @param spine - 脊柱路径（wire）。type:Shape required:true
 * @param opts - 扫掠配置（frenet / mode / tolerance 等）。type:SweepOptions required:false
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
