/**
 * dual-engine — 双引擎（OCCT × SMLib）扩展 API 面（公共出口）
 *
 * 库开发者取用：
 * ```ts
 * import { getDualEngineApi } from '@faicad/faijs/dual-engine'
 * const de = await getDualEngineApi()   // 引擎为 occt / smlib 时可用；brepkit 抛 BrepUnsupportedError
 * ```
 *
 * 本面是 L1 `BrepEngineApi` 的**双引擎扩展面**（继承 + 新增 loftSurface / ruledSurface /
 * offset）。需要 brepkit 兼容请继续使用 L1。设计见
 * `docs/plans/2026-10-28-occt-smlib-dual-engine-api-plan.md`（v2）。
 */

export type { DualEngineApi, DualEngineId } from './api'
export { smlibBridgeNotWired } from './api'
export { getDualEngineApi } from './registry'

/**
 * 机器可读的「语义 → {occt, smlib} 双实现名」映射（设计 §4.2；供门禁 / 文档 / 代码生成消费）。
 * 来源：`engine-method-map.json`（`dist/dual-engine/` 下随构建拷贝）。
 */
export { default as engineMethodMap } from './engine-method-map.json'
