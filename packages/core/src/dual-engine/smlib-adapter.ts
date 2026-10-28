/**
 * dual-engine/smlib-adapter — SMLib 双引擎适配器
 *
 * 实现 `DualEngineApi`：共享方法**复用 L1 SMLib 适配器**（`createSmlibPrimitives()`，即
 * `smlib-kernel/smlibKernel.ts` 对 wasm 桥的高层封送）；双引擎独有方法（loftSurface /
 * ruledSurface / offset）与历史追踪族在 SMLib 侧**待 wasm 桥补导出 / 未在 L1 暴露**，
 * 显式抛 `BrepUnsupportedError` 并指向方案 §4.3（中间态，桥补齐后接线即可移除抛错）。
 *
 * 设计依据：方案 v2 §2.1 历史追踪行确认 SMLib 经 `SmApiBooleanWithHistoryEx` /
 * `SmApiFilletWithHistoryEx`（桥 :665 / :703）提供 face 级历史，但这些**尚未在 L1 SMLib
 * 适配器暴露**；蒙皮 / 直纹 / 偏移的 SMLib 原生 API（`SmApiCreateSkin` /
 * `SmApiCreateRuledSurface` / `SmApiOffsetBrepFull`）亦在「待补桥」清单（§4.3 P0）。
 */

import { createSmlibPrimitives } from '../smlib-kernel/smlibKernel'
import { smlibBridgeNotWired } from './api'
import type { DualEngineApi } from './api'

/**
 * 构造 SMLib 双引擎 API 实例。
 *
 * @returns 实现 `DualEngineApi` 的 SMLib 适配器。
 * @throws 当 SMLib wasm 未装载（宿主未装配 SMLib 适配器）时，由 `createSmlibPrimitives` 抛错。
 */
export async function createSmlibDualEngineApi(): Promise<DualEngineApi> {
  // 共享方法：直接复用 L1 SMLib 适配器（已含 SMLib 侧全部 wasm 封送 / 单位换算）。
  const l1 = await createSmlibPrimitives()

  // 下列方法在本适配器构造时即固化为「桥未接」抛错——OCCT 侧已实现，SMLib 侧待补桥。
  // 用 `(): never` 签名兼容任意返回类型的方法（never 为底部类型）。
  const notWired = (method: string, native: string): (() => never) =>
    (): never => {
      throw smlibBridgeNotWired(method, native)
    }

  return {
    ...l1,

    // ── 双引擎独有（蒙皮 / 直纹 / 偏移）：SMLib 桥未接 ──
    loftSurface: notWired('loftSurface', 'SmApiCreateSkin'),
    ruledSurface: notWired('ruledSurface', 'SmApiCreateRuledSurface'),
    offset: notWired('offset', 'SmApiOffsetBrepFull'),

    // ── 历史追踪族：SMLib 桥已实现但未在 L1 适配器暴露 ──
    fuseWithHistory: notWired('fuseWithHistory', 'SmApiBooleanWithHistoryEx'),
    cutWithHistory: notWired('cutWithHistory', 'SmApiBooleanWithHistoryEx'),
    intersectWithHistory: notWired('intersectWithHistory', 'SmApiBooleanWithHistoryEx'),
    filletWithHistory: notWired('filletWithHistory', 'SmApiFilletWithHistoryEx'),
  }
}
