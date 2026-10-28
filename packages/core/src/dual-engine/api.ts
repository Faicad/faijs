/**
 * dual-engine/api — 双引擎（OCCT × SMLib）扩展 API 契约面
 *
 * 设计来源：`docs/plans/2026-10-28-occt-smlib-dual-engine-api-plan.md`（v2）。
 *
 * 定位（方案 §4.1）：本面是 L1 `BrepEngineApi` 的**双引擎扩展面**——
 * 承载「L1（三引擎最小子集）表达不了、但 occt + smlib 都原生支持」的能力
 * （如 §2.1 的蒙皮曲面 / 直纹面 / 实体偏移，以及历史追踪族）。库开发者：
 * 需要 brepkit 兼容 → L1；只面向 occt + smlib → 本面。
 *
 * ⚠️ 与 L1 的关系：本面**继承** `BrepEngineApi`（方案 §4.1「方法集 = §2.1 共同支持」，
 * 而 §2.1 的大部条目已落在 L1），只在末尾新增 3 个双引擎独有方法
 * （`loftSurface` / `ruledSurface` / `offset`）。适配器对继承来的共享方法**直接复用**
 * 现有 L1 适配器（occt / smlib），不对内核做二次封送（方案 §4.3.3「复用现 L1 适配器」）。
 *
 * 门禁（方案 §4.1）：本面**不支持 brepkit**——`getDualEngineApi()` 在引擎身份非
 * occt / smlib 时静态拒绝（抛 `BrepUnsupportedError`）。
 *
 * 量纲约定（与 L1 一致，非 faijs 外部 op 层）：本面角度参数沿用 L1 口径
 * （`rotate` 弧度、`revolveVec` / `draft` / `chamberDistAngle` 度）——外层 `cad.*` op
 * 的 fromBase 角度换算不在此处发生。带量纲参数不得裸数字的原则在本面沿用：所有
 * 长度/角度参数均以文档化单位声明，适配器内部按内核方言消化。
 */

import type { BrepEngineApi } from '../brep/engine/primitives'
import type { BrepHandle } from '../brep/engine/types'
import { BrepUnsupportedError } from '../runtime-state'

/** 双引擎面支持的内核身份（L1 的全集见 `BrepEngineId`；本面是它的子集）。 */
export type DualEngineId = 'occt' | 'smlib'

/**
 * 双引擎扩展 API 契约。继承 L1 `BrepEngineApi`（全部共享方法），新增 3 个双引擎独有方法。
 *
 * 句柄类型统一为 L1 的 {@link BrepHandle}（不透明 number）；适配器在调用内核前转换为
 * 内核原生句柄形态（OCCT `ShapeHandle` / SMLib 内部登记 id）。
 */
export interface DualEngineApi extends BrepEngineApi {
  /**
   * 蒙皮曲面（≈ OCCT `loft(wires, isSolid=false)`；SMLib `SmApiCreateSkin` **待补桥**）。
   *
   * 取一组截面（wire / face 取外环）蒙皮成**曲面**（非实体）。与 `loft(..., isSolid=true)`
   * 的区别：此处产物是面，需 `makeSolid` 才能成体。
   *
   * - occt 适配器：直连 `OcctKernel.loft(wires, false, ruled)`。
   * - smlib 适配器：`SmApiCreateSkin` 桥未接 → 抛 `BrepUnsupportedError`（方案 §4.3 P0）。
   *
   * @param wires - 截面（wire 或 face；face 取外环）数组。
   * @param ruled - 直线插值（直纹面）；缺省 false（平滑蒙皮）。
   */
  loftSurface(wires: BrepHandle[], ruled?: boolean): BrepHandle

  /**
   * 直纹面（OCCT `loft(wires, ruled=true)`；SMLib `SmApiCreateRuledSurface` **待补桥**）。
   * 两截面间的直线插值曲面，是 {@link loftSurface} 的 `ruled = true` 特例。
   *
   * @param wires - 截面数组（通常 2 条）。
   */
  ruledSurface(wires: BrepHandle[]): BrepHandle

  /**
   * 实体偏移（OCCT `offset(solid, distance, tolerance)`；SMLib `SmApiOffsetBrepFull` **待补桥**）。
   * 与 `shell`（抽壳，移除面）不同：offset 是沿法向整体加/减料。
   *
   * - occt 适配器：直连 `OcctKernel.offset`。
   * - smlib 适配器：`SmApiOffsetBrepFull` 桥未接 → 抛 `BrepUnsupportedError`（方案 §4.3 P0）。
   *
   * @param solid - 源实体。
   * @param distance - 偏移距离（正 = 外扩，负 = 内缩）。
   * @param tolerance - 容差。
   */
  offset(solid: BrepHandle, distance: number, tolerance: number): BrepHandle
}

/**
 * 生成「SMLib wasm 桥未接线」错误（方案 §4.3「待补桥」清单项在桥补齐前的中间态）。
 *
 * 这些能力 OCCT 侧已实现，SMLib 侧头文件有、但 `SmApiBridgeEx.cpp` 还没包装导出
 * （或桥已实现但未在 L1 SMLib 适配器暴露）。错误明确指向方案 §4.3，便于后续桥补后接线。
 *
 * @param method - 双引擎方法名。
 * @param smlibNative - SMLib 原生 API 名（如 `SmApiCreateSkin`）。
 * @returns 指向方案 §4.3 的 `BrepUnsupportedError`，供适配器在 SMLib 桥未接时抛出。
 */
export function smlibBridgeNotWired(method: string, smlibNative: string): BrepUnsupportedError {
  return new BrepUnsupportedError(
    `[dual-engine/smlib] ${method} 需要 SMLib wasm 桥补导出 ${smlibNative}（见方案 §4.3 P0/P1），当前未接线`,
  )
}
