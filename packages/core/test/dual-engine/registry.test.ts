/**
 * dual-engine/registry 门禁单测（方案 §4.1 / §4.3.5）
 *
 * 验证双引擎 API 取用的静态门禁：
 * - 引擎身份非 {occt, smlib}（brepkit / brep_mock / null）→ 抛 `BrepUnsupportedError`，
 *   且**不**静默回退、不调用任一适配器工厂（门禁在函数体最前、无旁路）；
 * - 引擎身份为 occt / smlib → 放行并路由到对应适配器工厂，且按引擎缓存（二次取用命中缓存）。
 *
 * 适配器构造依赖 wasm / 引擎注册，单测里用 `vi.mock` 替换成桩以隔离门禁逻辑本身
 * （与 `test/boolean/extrude-helpers.test.ts` 同构：工厂被 vi.mock 替换，被测模块经
 * 动态 `await import` 取用）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { configureHost } from '../support/host-env'
import { BrepUnsupportedError } from '../../src/runtime-state'
import { smlibBridgeNotWired } from '../../src/dual-engine/api'
import type { DualEngineApi } from '../../src/dual-engine/api'

// 双引擎适配器构造依赖 wasm / 引擎注册，单测里替换成可断言的桩。
const occtFactory = vi.fn()
const smlibFactory = vi.fn()
vi.mock('../../src/dual-engine/occt-adapter', () => ({
  createOcctDualEngineApi: (...args: unknown[]) => occtFactory(...args),
}))
vi.mock('../../src/dual-engine/smlib-adapter', () => ({
  createSmlibDualEngineApi: (...args: unknown[]) => smlibFactory(...args),
}))

const { getDualEngineApi, __resetDualEngineCacheForTests } = await import(
  '../../src/dual-engine/registry'
)

/** 桩实例：门禁单测不关心方法体，只关心「是否放行 + 路由到谁 + 是否缓存」。 */
const DUMMY = {} as unknown as DualEngineApi

beforeEach(() => {
  occtFactory.mockReset().mockResolvedValue(DUMMY)
  smlibFactory.mockReset().mockResolvedValue(DUMMY)
  __resetDualEngineCacheForTests()
})

describe('dual-engine registry 门禁（非 {occt,smlib} 拒绝）', () => {
  it.each(['brepkit', 'brep_mock', null])(
    '引擎 "%s" → 抛 BrepUnsupportedError，且不调用任一适配器工厂',
    async (engineId) => {
      configureHost('node', engineId)
      __resetDualEngineCacheForTests()

      await expect(getDualEngineApi()).rejects.toThrow(BrepUnsupportedError)

      // 门禁在函数体最前：拒绝后不得旁路到适配器构造。
      expect(occtFactory).not.toHaveBeenCalled()
      expect(smlibFactory).not.toHaveBeenCalled()
    },
  )
})

describe('dual-engine registry 放行（occt / smlib 路由 + 缓存）', () => {
  it('occt → 路由到 occt 工厂，且按引擎缓存（二次取用不重建）', async () => {
    configureHost('node', 'occt')
    __resetDualEngineCacheForTests()

    const api1 = await getDualEngineApi()
    expect(api1).toBe(DUMMY)
    expect(occtFactory).toHaveBeenCalledTimes(1)
    expect(smlibFactory).not.toHaveBeenCalled()

    const api2 = await getDualEngineApi()
    expect(api2).toBe(api1) // 命中缓存
    expect(occtFactory).toHaveBeenCalledTimes(1)
  })

  it('smlib → 路由到 smlib 工厂，且按引擎缓存（二次取用不重建）', async () => {
    configureHost('node', 'smlib')
    __resetDualEngineCacheForTests()

    const api1 = await getDualEngineApi()
    expect(api1).toBe(DUMMY)
    expect(smlibFactory).toHaveBeenCalledTimes(1)
    expect(occtFactory).not.toHaveBeenCalled()

    const api2 = await getDualEngineApi()
    expect(api2).toBe(api1) // 命中缓存
    expect(smlibFactory).toHaveBeenCalledTimes(1)
  })
})

describe('smlibBridgeNotWired 中间件', () => {
  it('返回 BrepUnsupportedError，并指明缺失的原生 API 与方案 §4.3', () => {
    const err = smlibBridgeNotWired('loftSurface', 'SmApiCreateSkin')
    expect(err).toBeInstanceOf(BrepUnsupportedError)
    expect(err.message).toContain('SmApiCreateSkin')
    expect(err.message).toContain('§4.3')
  })
})
