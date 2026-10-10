/**
 * api sweep — 扫掠（基础）：截面沿脊柱路径生成扫掠体。**两内核都支持**。
 *
 * 为什么不是 occt-only（方案 2026-10-10-sweep-loft-dual-engine-plan §3 总览 / §4）：
 * 基础扫掠（单截面沿路径，无过渡 / 引导线 / 缩放律）两个内核都能做 —— occt 走原生
 * `sweepPipeShell`（补两个默认开关 false），brepkit 走 `sweep(face, NURBS 路径)`；
 * 差异（brepkit 只吃 face、路径要 NURBS 四数组）由各自适配器消化，op 层只看到中立名
 * `BrepEngineApi#sweep`。完整控制面（transition / auxSpine / support / 解析式 law /
 * orientation）只有 occt 能做，整体归 `cad.sweepAdvanced`（与 `sketchOnFace →
 * sketchOnSurface` 同构）。
 *
 * occt 侧**不用** `simplePipe`：实测它对 8×8 方截面沿 +Z 扫 50 产出体积 2133.33，
 * 而 `sweepPipeShell` 为解析值 3200（`test/api/sweep-loft.test.ts` 的真值断言）。
 *
 * ⚠️ 两内核在非平面路径上的截面参考系算法不同（RMF 细节差异），复杂路径下产物
 * 可能有细微差别；需要确定性行为用 `cad.sweepAdvanced`（occt）。
 */

import type { Shape } from '../mesh/types'
import { defineOp } from '../sdk'
import type { Provenance } from '../topology/naming/lineage'
import { getBrepApi } from '../brep/handle-bridge'
import { fromBrep } from '../shape'
import { solidToShape } from '../brep/brep-ops'
import { toProfileWireView } from './internal/profile-wire'

/** BREP 路径：截面沿脊柱扫掠（两引擎经 L1 中立名 `BrepEngineApi#sweep` 分派）。 */
function sweepBrep(profile: Shape, spine: Shape): Shape {
  if (!profile) throw new Error('E_SWEEP_NO_PROFILE: sweep requires a profile (section) shape')
  if (!spine) throw new Error('E_SWEEP_NO_SPINE: sweep requires a spine (path) shape')
  // 截面 / 脊柱：wire 直用；面取外环（孔环不参与扫掠）。
  const profileWire = toProfileWireView(profile)
  const spineWire = toProfileWireView(spine)
  const kernel = getBrepApi()
  try {
    const h = kernel.sweep(profileWire.wrapped, spineWire.wrapped)
    return fromBrep(solidToShape(kernel, h), { solid: h })
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e)
    throw new Error(`E_SWEEP_FAILED: sweep failed: ${raw}`, { cause: e })
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
 * @note 基础 op：**occt 与 brepkit 两内核都支持**（occt `sweepPipeShell`；brepkit
 *       `sweep(face, NURBS path)`，路径由适配器从脊柱 wire 拟合）。截面接受 wire
 *       或面（面取其外环）；脊柱必须为 wire。选项集 = 两内核交集 = **空** ——
 *       需要 transition / auxSpine / support / law / orientation 等 occt 独有控制面
 *       时用 `cad.sweepAdvanced`。
 * @returns Shape 扫掠体。
 * @param profile - 截面几何（wire 或面；面取其外环）。type:Shape required:true
 * @param spine - 脊柱路径（wire）。type:Shape required:true
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
  brep(profile: Shape, spine: Shape) {
    return sweepBrep(profile, spine)
  },
  naming: { kind: 'unmodeled', reason: 'swept-body face vocabulary not defined' } as Provenance,
})
