/**
 * dual-engine/registry — 双引擎 API 门禁与取用
 *
 * 方案 §4.1 / §4.3.5：双引擎面**不支持 brepkit**。本模块是库开发者取用双引擎面的唯一出口：
 * - 引擎身份为 occt / smib → 返回对应适配器（按引擎缓存）；
 * - 其余（brepkit / brep_mock / null）→ 静态抛 `BrepUnsupportedError`，**不静默回退**。
 *
 * 与 L1 的 `getBrepApi()` 不同：L1 取「当前活动引擎」（可能为 brepkit）；本面取「双引擎能力面」，
 * 并要求引擎身份必须在 {occt, smlib} 内。
 */

import { BrepUnsupportedError, getConfiguredBrepEngineId } from '../runtime-state'
import type { DualEngineApi, DualEngineId } from './api'
import { createOcctDualEngineApi } from './occt-adapter'
import { createSmlibDualEngineApi } from './smlib-adapter'

/** 门禁缓存（按引擎身份；适配器构造后缓存，运行期只读）。 */
const cache = new Map<DualEngineId, DualEngineApi>()

/**
 * 取用双引擎 API 实例（静态门禁 + 按引擎缓存）。
 *
 * @returns 当前配置引擎（occt / smlib）对应的 `DualEngineApi` 实例。
 * @throws 当配置引擎非 occt / smlib（如 brepkit / brep_mock / 未配置 null）时，
 *   抛 `BrepUnsupportedError`（code 同 L1 不支持类，由 CadRuntime 收编为 failedAt）。
 */
export async function getDualEngineApi(): Promise<DualEngineApi> {
  const id = getConfiguredBrepEngineId()
  if (id !== 'occt' && id !== 'smlib') {
    throw new BrepUnsupportedError(
      `[dual-engine] 双引擎 API 面不支持内核 '${id ?? 'null'}'；仅支持 occt / smlib（不含 brepkit / brep_mock）。`,
    )
  }
  const key = id as DualEngineId
  const existing = cache.get(key)
  if (existing) return existing
  const api = key === 'occt' ? await createOcctDualEngineApi() : await createSmlibDualEngineApi()
  cache.set(key, api)
  return api
}

/**
 * 仅测试用：清除门禁缓存（不进任何公共导出面）。
 */
export function __resetDualEngineCacheForTests(): void {
  cache.clear()
}
