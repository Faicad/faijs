/**
 * engine/registry 测试（§6.2 双槽位注册表 + R8 冻结语义 + 异步 provider）
 *
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerBrepEngine,
  registerMeshEngine,
  getBrepEngine,
  getMeshEngine,
  getActiveBrepEngineId,
  getActiveMeshEngineId,
  hasBrepEngine,
  freezeEngineRegistries,
  __resetEngineRegistriesForTests,
  type BrepEngine,
  type MeshEngine,
} from '../../../src/brep/engine/registry'
import type { BrepEngineApi } from '../../../src/brep/engine/primitives'

/** Phase 1 编译期守卫（§7.8）骨架：真实适配器（occt/memory）实现 BrepEngineApi 后，
 *  用 `type _AssertSatisfiesBrepEngineApi = () => BrepEngineApi` 断言，漏实现任何
 *  方法 → tsc 精确列出缺失属性。此处仅以 mock 演示注册形态，守卫随适配器落地。 */
function mockPrimitives(): BrepEngineApi {
  return {} as unknown as BrepEngineApi
}

function mockBrep(id: string): BrepEngine {
  return { id, primitives: mockPrimitives() }
}

/** 异步 provider 注册形式（引擎初始化可能异步：wasm 加载等）。 */
function registerMock(id: string): void {
  registerBrepEngine(id, async () => mockBrep(id))
}

function mockMesh(id: string): MeshEngine {
  return { id }
}

beforeEach(() => {
  __resetEngineRegistriesForTests()
})

describe('BREP 槽（槽位 1，异步 provider）', () => {
  it('首个注册者自动成为默认', async () => {
    registerMock('occt')
    registerMock('remus')
    expect(getActiveBrepEngineId()).toBe('occt')
    expect((await getBrepEngine()).id).toBe('occt')
  })

  it('可按 id 取指定引擎', async () => {
    registerMock('occt')
    registerMock('remus')
    expect((await getBrepEngine('remus')).id).toBe('remus')
    expect((await getBrepEngine('occt')).id).toBe('occt')
  })

  it('provider 只解析一次（结果缓存，幂等）', async () => {
    let resolves = 0
    registerBrepEngine('counting', async () => {
      resolves += 1
      return mockBrep('counting')
    })
    await getBrepEngine('counting')
    await getBrepEngine('counting')
    expect(resolves).toBe(1)
  })

  it('未注册 id 抛错；未注册任何引擎时 getBrepEngine() 抛错且 hasBrepEngine() 为 false', async () => {
    expect(hasBrepEngine()).toBe(false)
    await expect(getBrepEngine('nope')).rejects.toThrow(/not registered/)
    await expect(getBrepEngine()).rejects.toThrow(/no BREP engine registered/)
    expect(getActiveBrepEngineId()).toBeNull()
  })

  it('注册后 hasBrepEngine() 为 true', () => {
    registerMock('occt')
    expect(hasBrepEngine()).toBe(true)
  })

  it('重复注册同一 id 抛错', () => {
    registerMock('occt')
    expect(() => registerMock('occt')).toThrow(/already registered/)
  })

  it('BrepEngine 仅 id + primitives——能力声明轴已删除（2026-10-08）', async () => {
    // 「引擎能做什么」不再由引擎侧声明对象表达：真实引擎的事实是
    // `brep/engine/native-history.ts` 的常量（面演化）与适配器实现本身。
    registerMock('occt')
    const engine = await getBrepEngine('occt')
    expect(Object.keys(engine).sort()).toEqual(['id', 'primitives'])
  })
})

describe('mesh 槽（槽位 2）与 R2 正交性', () => {
  it('mesh 槽独立注册、独立默认，不影响 BREP 槽', async () => {
    registerMock('occt')
    registerMeshEngine('manifold', mockMesh('manifold'))
    expect(getActiveBrepEngineId()).toBe('occt')
    expect(getActiveMeshEngineId()).toBe('manifold')
    expect(getMeshEngine().id).toBe('manifold')
    expect((await getBrepEngine()).id).toBe('occt')
  })

  it('mesh 槽未注册时 getMeshEngine() 抛错', () => {
    expect(() => getMeshEngine()).toThrow(/not registered/)
  })
})

describe('R8 冻结语义（Phase 4 E2 的注册表部分）', () => {
  it('freeze 后任何注册尝试抛错，读取不受影响', async () => {
    registerMock('occt')
    freezeEngineRegistries()
    expect(() => registerMock('remus')).toThrow(/registry frozen/)
    expect(() => registerMeshEngine('manifold', mockMesh('manifold'))).toThrow(/registry frozen/)
    // 只读：get 仍然可用
    expect((await getBrepEngine('occt')).id).toBe('occt')
  })
})
