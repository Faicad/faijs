/**
 * stdlib sweep — 扫掠：截面沿脊柱路径生成扫掠体（手写平台 op，Phase 4）
 *
 * @platform occt — 实现走 vendored `sweep`（`BRepOffsetAPI_MakePipeShell` /
 * `BRepOffsetAPI_MakePipe`；engine-method-map 里 `sweepPipeShell` / `simplePipe`
 * 均为 occt-only）⇒ 平台 op：defineOp 声明 `engines: ['occt']`（D11）。
 *
 * 为什么手写而不走生成投影：脚本面最常见的截面来源是 `cad.sketch(...)`（产出
 * **face**），而 vendored `sweep(wire, spine, …)` 只吃 **wire** ⇒ 需要「面 → 外环」
 * 输入适配（`internal/profile-wire.ts` 的唯一步径）。单柄借入的生成模板不做这件事，
 * 与 `api/extrude.ts` 同因（先例：arg-spec 里 `fillet` / `extrude` 的 faijs 侧由手写
 * dual-op 覆盖）。
 *
 * 截面接受 1D wire（`cad.wire` / `cad.helix` / `cad.sketch({as:'wire'})`）或 2D 面
 * （`cad.sketch`）；脊柱必须是 wire。
 *
 * 不暴露 vendored 的 `shellMode`：它返回 `[shell, startWire, endWire]` **元组**，
 * 跨不过单产物边界（设计原则 5：多产物一律用具名 `outputs`，不用数组）。
 */

import type { Shape } from '../mesh/types'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { sweep as vendoredSweep, type SweepOptions } from '@faicad/faijs-brepjs/operations/sweepFns.js'
import { adoptEntity, callBrepjs } from './internal/l3-bridge'
import { borrowDeep, unwrapOrThrow } from './internal/compat-op'
import { toProfileWireView } from './internal/profile-wire'

export type { SweepOptions }

/** BREP 路径：截面沿脊柱扫掠（borrow → vendored 调用 → Result 翻转 → 收养）。 */
function sweepBrep(profile: Shape, spine: Shape, opts?: SweepOptions): Shape {
  if (!profile) throw new Error('E_SWEEP_NO_PROFILE: sweep requires a profile (section) shape')
  if (!spine) throw new Error('E_SWEEP_NO_SPINE: sweep requires a spine (path) shape')
  // 截面 / 脊柱：wire 直用；面取外环（孔环不参与扫掠）。
  // 脊柱容忍 face（FCStd 翻译把脊柱基对象 sketch 整圈外廓当路径，覆盖「子选中边=整圈外廓」
  // 的主导情形；与截面同一口径，收口在 profile-wire.ts）。
  const profileWire = toProfileWireView(profile)
  const spineWire = toProfileWireView(spine)
  // 选项里可能嵌 faijs Shape（auxiliarySpine / support）——与 compatOp 同款深借入，
  // 否则那些字段会以 faijs Shape 原形落进 vendored 代码（读不到 .wrapped）。
  const config = (borrowDeep(opts ?? {}, 0) ?? {}) as SweepOptions
  const r = callBrepjs(vendoredSweep, [profileWire, spineWire, config, false])
  return adoptEntity(unwrapOrThrow(r, 'sweep'), 'sweep') as Shape
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
 * @param opts - 扫掠配置（frenet / transitionMode / mode / tolerance 等）。type:SweepOptions required:false
 * @example
 * const path = cad.wire([[0, 0, 0], [0, 0, 50]])
 * const section = cad.sketch({ contours: [{ segments: [
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
